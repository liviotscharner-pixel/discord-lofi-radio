import {
  AudioPlayer,
  AudioPlayerStatus,
  AudioResource,
  createAudioPlayer,
  createAudioResource,
  demuxProbe,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus,
  DiscordGatewayAdapterCreator,
} from '@discordjs/voice';
import { spawn, type ChildProcess } from 'child_process';
import { Guild, GuildMember, VoiceBasedChannel } from 'discord.js';
import { getStation, STATIONS } from '../stations';
import type { Station } from '../types';

interface GuildRadioState {
  connection: VoiceConnection;
  player: AudioPlayer;
  station: Station;
  channelId: string;
  textChannelId: string | null;
  sourceProcess: ChildProcess | null;
  restarting: boolean;
}

function isYouTubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname.includes('youtube.com') ||
      u.hostname.includes('youtu.be') ||
      u.hostname.includes('youtube-nocookie.com')
    );
  } catch {
    return false;
  }
}

/**
 * Manages one radio session per guild: join, play stream/YouTube, switch, stop, loop.
 */
export class RadioManager {
  private readonly sessions = new Map<string, GuildRadioState>();

  getStation(guildId: string): Station | null {
    return this.sessions.get(guildId)?.station ?? null;
  }

  isPlaying(guildId: string): boolean {
    const session = this.sessions.get(guildId);
    if (!session) return false;
    return (
      session.player.state.status === AudioPlayerStatus.Playing ||
      session.player.state.status === AudioPlayerStatus.Buffering
    );
  }

  async play(
    member: GuildMember,
    stationId: string,
    textChannelId?: string,
  ): Promise<{ station: Station; switched: boolean }> {
    const station = getStation(stationId);
    if (!station) {
      throw new RadioError('Unbekannter Sender.', true);
    }

    const channel = member.voice.channel;
    if (!channel) {
      throw new RadioError(
        'Du musst in einem Voice-Channel sein, damit ich beitreten kann.',
        true,
      );
    }

    const me = member.guild.members.me;
    const permissions = channel.permissionsFor(me!);
    if (!permissions?.has(['Connect', 'Speak'])) {
      throw new RadioError(
        'Mir fehlen die Berechtigungen **Verbinden** und **Sprechen** in diesem Channel.',
        true,
      );
    }
    if (!channel.joinable) {
      throw new RadioError(
        'Ich kann diesem Voice-Channel nicht beitreten (voll oder gesperrt).',
        true,
      );
    }

    const existing = this.sessions.get(member.guild.id);
    if (existing && existing.channelId === channel.id) {
      await this.startStream(existing, station);
      if (textChannelId) existing.textChannelId = textChannelId;
      return { station, switched: true };
    }

    if (existing) {
      this.destroySession(member.guild.id);
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild
        .voiceAdapterCreator as DiscordGatewayAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });

    connection.subscribe(player);

    const session: GuildRadioState = {
      connection,
      player,
      station,
      channelId: channel.id,
      textChannelId: textChannelId ?? null,
      sourceProcess: null,
      restarting: false,
    };

    this.wireLifecycle(member.guild.id, session);
    this.sessions.set(member.guild.id, session);

    try {
      await this.waitUntilReady(connection, 45_000);
    } catch (err) {
      const status = connection.state.status;
      console.error(
        `[radio] Voice Ready timeout. status=${status}`,
        err instanceof Error ? err.message : err,
      );
      this.destroySession(member.guild.id);
      throw new RadioError(
        'Verbindung zum Voice-Channel fehlgeschlagen. Bitte erneut versuchen.',
        true,
      );
    }

    await this.startStream(session, station);
    return { station, switched: false };
  }


  /**
   * Join a specific voice channel and play a station (used for auto-start).
   */
  async playInChannel(
    guild: Guild,
    channel: VoiceBasedChannel,
    stationId: string,
  ): Promise<{ station: Station; switched: boolean }> {
    const station = getStation(stationId);
    if (!station) {
      throw new RadioError('Unbekannter Sender.', true);
    }

    const me = guild.members.me;
    const permissions = channel.permissionsFor(me!);
    if (!permissions?.has(['Connect', 'Speak'])) {
      throw new RadioError(
        'Mir fehlen die Berechtigungen **Verbinden** und **Sprechen** in diesem Channel.',
        true,
      );
    }
    if (!channel.joinable) {
      throw new RadioError(
        'Ich kann diesem Voice-Channel nicht beitreten (voll oder gesperrt).',
        true,
      );
    }

    const existing = this.sessions.get(guild.id);
    if (existing && existing.channelId === channel.id) {
      // Already in this channel — only (re)start if station differs or not playing.
      if (existing.station.id !== station.id || existing.player.state.status === AudioPlayerStatus.Idle) {
        await this.startStream(existing, station);
      }
      return { station, switched: existing.station.id !== station.id };
    }

    if (existing) {
      this.destroySession(guild.id);
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });

    connection.subscribe(player);

    const session: GuildRadioState = {
      connection,
      player,
      station,
      channelId: channel.id,
      textChannelId: null,
      sourceProcess: null,
      restarting: false,
    };

    this.wireLifecycle(guild.id, session);
    this.sessions.set(guild.id, session);

    try {
      await this.waitUntilReady(connection, 45_000);
    } catch (err) {
      console.error(
        `[radio] Voice Ready timeout (auto). status=${connection.state.status}`,
        err instanceof Error ? err.message : err,
      );
      this.destroySession(guild.id);
      throw new RadioError(
        'Verbindung zum Voice-Channel fehlgeschlagen. Bitte erneut versuchen.',
        true,
      );
    }

    await this.startStream(session, station);
    return { station, switched: false };
  }

  async switchStation(guildId: string, stationId: string): Promise<Station> {
    const session = this.sessions.get(guildId);
    if (!session) {
      throw new RadioError(
        'Aktuell läuft kein Radio. Starte zuerst mit `/radio`.',
        true,
      );
    }
    const station = getStation(stationId);
    if (!station) {
      throw new RadioError('Unbekannter Sender.', true);
    }
    await this.startStream(session, station);
    return station;
  }

  stop(guildId: string): boolean {
    if (!this.sessions.has(guildId)) return false;
    this.destroySession(guildId);
    return true;
  }


  private async waitUntilReady(
    connection: VoiceConnection,
    timeoutMs: number,
  ): Promise<void> {
    const started = Date.now();
    const onChange = (oldState: { status: string }, newState: { status: string }) => {
      console.log(`[voice] ${oldState.status} -> ${newState.status}`);
    };
    connection.on('stateChange', onChange as never);

    try {
      while (Date.now() - started < timeoutMs) {
        const status = connection.state.status;
        if (status === VoiceConnectionStatus.Ready) return;
        if (status === VoiceConnectionStatus.Destroyed) {
          throw new Error('Voice connection destroyed before Ready');
        }

        const elapsed = Date.now() - started;
        if (
          (status === VoiceConnectionStatus.Signalling ||
            status === VoiceConnectionStatus.Connecting ||
            status === VoiceConnectionStatus.Disconnected) &&
          elapsed > 10_000
        ) {
          // Rejoin at most once around the 10s mark.
          if (elapsed < 11_000) {
            console.log(`[voice] ${status} after ${elapsed}ms — rejoin()`);
            try {
              connection.rejoin();
            } catch (e) {
              console.error('[voice] rejoin failed', e);
            }
          }
        }

        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(
        `Voice Ready timeout after ${timeoutMs}ms (last=${connection.state.status})`,
      );
    } finally {
      connection.off('stateChange', onChange as never);
    }
  }

  private async startStream(
    session: GuildRadioState,
    station: Station,
  ): Promise<void> {
    session.station = station;
    this.killSource(session);
    try {
      const resource = await this.createStreamResource(session, station.url);
      session.player.play(resource);
    } catch (err) {
      console.error(`[radio] Failed to start stream ${station.id}:`, err);
      throw new RadioError(
        `Stream für **${station.name}** konnte nicht gestartet werden.`,
        true,
      );
    }
  }

  private async createStreamResource(
    session: GuildRadioState,
    url: string,
  ): Promise<AudioResource> {
    if (!isYouTubeUrl(url)) {
      return createAudioResource(url, {
        inputType: StreamType.Arbitrary,
        inlineVolume: false,
        metadata: { url },
      });
    }

    const proc = spawn(
      'yt-dlp',
      [
        '-o',
        '-',
        '-f',
        'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best',
        '--no-playlist',
        '--quiet',
        '--no-warnings',
        url,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    session.sourceProcess = proc;

    proc.stderr.on('data', (buf: Buffer) => {
      const msg = buf.toString().trim();
      if (msg) console.error(`[yt-dlp] ${msg.slice(0, 300)}`);
    });

    proc.on('error', (err) => {
      console.error('[yt-dlp] spawn error:', err.message);
    });

    if (!proc.stdout) {
      throw new Error('yt-dlp stdout missing');
    }

    try {
      const { stream, type } = await demuxProbe(proc.stdout);
      return createAudioResource(stream, {
        inputType: type,
        metadata: { url },
      });
    } catch (err) {
      this.killSource(session);
      throw err;
    }
  }

  private wireLifecycle(guildId: string, session: GuildRadioState): void {
    session.connection.on('stateChange', (oldState, state) => {
      console.log(`[voice:${guildId}] ${oldState.status} -> ${state.status}`);
      if (state.status === VoiceConnectionStatus.Destroyed) {
        if (this.sessions.get(guildId)?.connection === session.connection) {
          this.destroySession(guildId);
        }
      }
    });

    session.player.on('error', (error) => {
      console.error(`[radio] Player error in guild ${guildId}:`, error.message);
      void this.restartCurrent(guildId, session);
    });

    session.player.on(AudioPlayerStatus.Idle, () => {
      // End of YouTube mix (or dropped stream) → loop forever while session lives.
      void this.restartCurrent(guildId, session);
    });
  }

  private async restartCurrent(
    guildId: string,
    session: GuildRadioState,
  ): Promise<void> {
    const current = this.sessions.get(guildId);
    if (!current || current.player !== session.player) return;
    if (current.restarting) return;
    current.restarting = true;
    try {
      await this.startStream(current, current.station);
    } catch (err) {
      console.error(`[radio] Loop restart failed:`, err);
    } finally {
      current.restarting = false;
    }
  }

  private killSource(session: GuildRadioState): void {
    const proc = session.sourceProcess;
    session.sourceProcess = null;
    if (!proc || proc.killed) return;
    try {
      proc.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }


  /** Leave and stop if no non-bot members remain in the bot's current channel. */
  maybeStopIfChannelEmpty(guild: Guild): boolean {
    const session = this.sessions.get(guild.id);
    if (!session) return false;
    const channel = guild.channels.cache.get(session.channelId);
    if (!channel || !channel.isVoiceBased()) {
      this.destroySession(guild.id);
      return true;
    }
    const humans = channel.members.filter((m) => !m.user.bot);
    if (humans.size === 0) {
      this.destroySession(guild.id);
      return true;
    }
    return false;
  }

  private destroySession(guildId: string): void {
    const session = this.sessions.get(guildId);
    if (!session) return;
    this.sessions.delete(guildId);
    this.killSource(session);
    try {
      session.player.stop(true);
    } catch {
      /* ignore */
    }
    try {
      session.connection.destroy();
    } catch {
      /* ignore */
    }
  }
}

export class RadioError extends Error {
  constructor(
    message: string,
    public readonly ephemeral: boolean = true,
  ) {
    super(message);
    this.name = 'RadioError';
  }
}

export function stationListEmbedFields() {
  return STATIONS.map((s) => ({
    name: s.name,
    value: s.description,
    inline: false,
  }));
}
