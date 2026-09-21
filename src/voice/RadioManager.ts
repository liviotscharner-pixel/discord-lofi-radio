import {
  AudioPlayer,
  AudioPlayerStatus,
  AudioResource,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus,
  DiscordGatewayAdapterCreator,
} from '@discordjs/voice';
import { GuildMember } from 'discord.js';
import { getStation, STATIONS } from '../stations';
import type { Station } from '../types';

interface GuildRadioState {
  connection: VoiceConnection;
  player: AudioPlayer;
  station: Station;
  channelId: string;
  textChannelId: string | null;
}

/**
 * Manages one radio session per guild: join, play stream, switch, stop.
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
      this.startStream(existing, station);
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
      selfDeaf: true,
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
    };

    this.wireLifecycle(member.guild.id, session);
    this.sessions.set(member.guild.id, session);

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      this.destroySession(member.guild.id);
      throw new RadioError(
        'Verbindung zum Voice-Channel fehlgeschlagen. Bitte erneut versuchen.',
        true,
      );
    }

    this.startStream(session, station);
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
    this.startStream(session, station);
    return station;
  }

  stop(guildId: string): boolean {
    if (!this.sessions.has(guildId)) return false;
    this.destroySession(guildId);
    return true;
  }

  private startStream(session: GuildRadioState, station: Station): void {
    session.station = station;
    try {
      const resource = this.createStreamResource(station.url);
      session.player.play(resource);
    } catch (err) {
      console.error(`[radio] Failed to start stream ${station.id}:`, err);
      throw new RadioError(
        `Stream für **${station.name}** konnte nicht gestartet werden.`,
        true,
      );
    }
  }

  private createStreamResource(url: string): AudioResource {
    // FFmpeg (must be on PATH) demuxes Icecast/MP3 into Opus-ready PCM.
    return createAudioResource(url, {
      inputType: StreamType.Arbitrary,
      inlineVolume: false,
      metadata: { url },
    });
  }

  private wireLifecycle(guildId: string, session: GuildRadioState): void {
    session.connection.on('stateChange', (_old, state) => {
      if (
        state.status === VoiceConnectionStatus.Disconnected ||
        state.status === VoiceConnectionStatus.Destroyed
      ) {
        if (this.sessions.get(guildId)?.connection === session.connection) {
          this.destroySession(guildId);
        }
      }
    });

    session.player.on('error', (error) => {
      console.error(`[radio] Player error in guild ${guildId}:`, error.message);
      const current = this.sessions.get(guildId);
      if (current && current.player === session.player) {
        try {
          const resource = this.createStreamResource(current.station.url);
          current.player.play(resource);
        } catch (restartErr) {
          console.error(`[radio] Restart failed:`, restartErr);
        }
      }
    });
  }

  private destroySession(guildId: string): void {
    const session = this.sessions.get(guildId);
    if (!session) return;
    this.sessions.delete(guildId);
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
