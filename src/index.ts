import dotenv from 'dotenv';
dotenv.config({ override: true });
import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  Interaction,
  MessageFlags,
  Partials,
  REST,
  Routes,
} from 'discord.js';
import { generateDependencyReport } from '@discordjs/voice';
import { commandDefinitions } from './commands/definitions';
import { RadioError, RadioManager } from './voice/RadioManager';
import {
  controlButtons,
  CUSTOM_IDS,
  idleEmbed,
  nowPlayingEmbed,
} from './ui/controls';
import { STATIONS, getStationByVoiceChannelId, isStationId } from './stations';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error('Fehlende Umgebungsvariablen: DISCORD_TOKEN und DISCORD_CLIENT_ID.');
  process.exit(1);
}

console.log(generateDependencyReport());

const radio = new RadioManager();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(token!);
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId!, guildId), {
      body: commandDefinitions,
    });
    console.log(`Slash-Commands guild-scoped registriert (${guildId}).`);
  } else {
    await rest.put(Routes.applicationCommands(clientId!), {
      body: commandDefinitions,
    });
    console.log('Slash-Commands global registriert.');
  }
}

async function handleRadio(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  const stationId = interaction.options.getString('station', true);
  if (!isStationId(stationId)) {
    await interaction.reply({
      content: 'Unbekannter Sender.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!interaction.guild) {
    await interaction.reply({
      content: 'Dieser Befehl funktioniert nur auf einem Server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);

  if (!member.voice.channel) {
    await interaction.reply({
      content: '❌ Du musst in einem Voice-Channel sein, damit ich beitreten kann.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const me = interaction.guild.members.me;
  const perms = member.voice.channel.permissionsFor(me!);
  if (!perms?.has(['Connect', 'Speak'])) {
    await interaction.reply({
      content:
        '❌ Mir fehlen die Berechtigungen **Verbinden** und **Sprechen** in diesem Channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();
  try {
    const { station } = await radio.play(
      member,
      stationId,
      interaction.channelId,
    );
    await interaction.editReply({
      embeds: [nowPlayingEmbed(station, interaction.user.tag)],
      components: [controlButtons(station.id)],
    });
  } catch (err) {
    const message =
      err instanceof RadioError
        ? err.message
        : 'Ein unerwarteter Fehler ist aufgetreten.';
    console.error('[/radio]', err);
    await interaction.editReply({ content: `❌ ${message}` });
  }
}

async function handleStop(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) {
    await interaction.reply({
      content: 'Dieser Befehl funktioniert nur auf einem Server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const stopped = radio.stop(interaction.guild.id);
  if (!stopped) {
    await interaction.reply({
      content: 'Es läuft gerade kein Radio.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    embeds: [
      idleEmbed().setDescription(
        '⏹ Wiedergabe gestoppt – Voice-Channel verlassen.',
      ),
    ],
  });
}

async function handleNow(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) {
    await interaction.reply({
      content: 'Dieser Befehl funktioniert nur auf einem Server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const station = radio.getStation(interaction.guild.id);
  if (!station) {
    await interaction.reply({
      embeds: [idleEmbed()],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    embeds: [nowPlayingEmbed(station)],
    components: [controlButtons(station.id)],
  });
}

async function handleStationSwitch(
  interaction: Interaction,
  stationId: string,
): Promise<void> {
  if (!interaction.isMessageComponent()) return;
  if (!interaction.guild) {
    await interaction.reply({
      content: 'Nur auf einem Server möglich.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!isStationId(stationId)) {
    await interaction.reply({
      content: 'Unbekannter Sender.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    if (radio.getStation(interaction.guild.id)) {
      const station = await radio.switchStation(interaction.guild.id, stationId);
      await interaction.update({
        embeds: [nowPlayingEmbed(station, interaction.user.tag)],
        components: [controlButtons(station.id)],
      });
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.voice.channel) {
      await interaction.reply({
        content: '❌ Du musst in einem Voice-Channel sein.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();
    const { station } = await radio.play(
      member,
      stationId,
      interaction.channelId,
    );
    await interaction.editReply({
      embeds: [nowPlayingEmbed(station, interaction.user.tag)],
      components: [controlButtons(station.id)],
    });
  } catch (err) {
    const message =
      err instanceof RadioError
        ? err.message
        : 'Senderwechsel fehlgeschlagen.';
    console.error('[switch]', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: `❌ ${message}`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({
        content: `❌ ${message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

async function autoStartMappedChannels(guildId: string): Promise<void> {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;
  await guild.channels.fetch().catch(() => undefined);

  for (const station of STATIONS) {
    if (!station.voiceChannelId) continue;
    const channel = guild.channels.cache.get(station.voiceChannelId);
    if (!channel || !channel.isVoiceBased()) continue;
    const humans = channel.members.filter((m) => !m.user.bot);
    if (humans.size === 0) continue;
    try {
      console.log(
        `[auto] Starte ${station.name} in #${channel.name} (${humans.size} Hörer)`,
      );
      await radio.playInChannel(guild, channel, station.id);
      // One voice connection per guild — prefer the first occupied mapped channel.
      return;
    } catch (err) {
      console.error(`[auto] Start fehlgeschlagen für ${station.id}:`, err);
    }
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Eingeloggt als ${c.user.tag}`);
  try {
    await registerCommands();
  } catch (err) {
    console.error('Command-Registrierung fehlgeschlagen:', err);
  }
  c.user.setActivity('Lofi Radio 🎧', { type: ActivityType.Listening });

  if (guildId) {
    await autoStartMappedChannels(guildId);
  }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    if (newState.member?.user.bot) return;

    const joinedId = newState.channelId;
    const leftId = oldState.channelId;
    const moved = joinedId && joinedId !== leftId;

    if (moved && joinedId) {
      const station = getStationByVoiceChannelId(joinedId);
      if (station && newState.guild && newState.channel?.isVoiceBased()) {
        console.log(
          `[auto] ${newState.member?.user.tag ?? 'user'} → #${newState.channel.name} → ${station.name}`,
        );
        await radio.playInChannel(newState.guild, newState.channel, station.id);
        return;
      }
    }

    // Stop when the last human leaves the channel the bot is playing in.
    if (leftId && leftId !== joinedId && oldState.guild) {
      radio.maybeStopIfChannelEmpty(oldState.guild);
    }
  } catch (err) {
    console.error('[auto] VoiceStateUpdate error:', err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'radio':
          await handleRadio(interaction);
          break;
        case 'stop':
          await handleStop(interaction);
          break;
        case 'now':
          await handleNow(interaction);
          break;
        default:
          break;
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith(CUSTOM_IDS.buttonPrefix)) {
        const id = interaction.customId.slice(CUSTOM_IDS.buttonPrefix.length);
        await handleStationSwitch(interaction, id);
      }
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === CUSTOM_IDS.selectStation) {
        const id = interaction.values[0];
        await handleStationSwitch(interaction, id);
      }
    }
  } catch (err) {
    console.error('[interaction]', err);
    if (
      interaction.isRepliable() &&
      !interaction.replied &&
      !interaction.deferred
    ) {
      await interaction
        .reply({
          content: '❌ Unerwarteter Fehler.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => undefined);
    }
  }
});

client.login(token);
