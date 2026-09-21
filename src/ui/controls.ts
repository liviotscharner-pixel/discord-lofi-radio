import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { STATIONS } from '../stations';
import type { Station } from '../types';

export const CUSTOM_IDS = {
  selectStation: 'lofi:select',
  buttonPrefix: 'lofi:btn:',
} as const;

export function nowPlayingEmbed(station: Station, userTag?: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x7c5cfc)
    .setTitle('🎧 Lofi Radio')
    .setDescription(`**Jetzt läuft:** ${station.name}`)
    .addFields({ name: 'Beschreibung', value: station.description })
    .setFooter({ text: 'Wechsle den Sender mit den Buttons unten' })
    .setTimestamp();

  if (userTag) {
    embed.addFields({ name: 'Gestartet von', value: userTag, inline: true });
  }
  return embed;
}

export function controlButtons(activeId?: string): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const station of STATIONS) {
    const active = station.id === activeId;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_IDS.buttonPrefix}${station.id}`)
        .setLabel(station.name)
        .setStyle(active ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setEmoji(emojiFor(station.id)),
    );
  }
  return row;
}

export function controlSelect(activeId?: string): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CUSTOM_IDS.selectStation)
      .setPlaceholder('Sender wechseln…')
      .addOptions(
        STATIONS.map((s) => ({
          label: s.name,
          description: s.description.slice(0, 100),
          value: s.id,
          default: s.id === activeId,
          emoji: emojiFor(s.id),
        })),
      ),
  );
}

function emojiFor(id: string): string {
  switch (id) {
    case 'hiphop':
      return '🎤';
    case 'house':
      return '🏠';
    case 'gaming':
      return '🎮';
    default:
      return '🎵';
  }
}

export function idleEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎧 Lofi Radio')
    .setDescription('Kein Sender aktiv. Starte mit `/radio`.')
    .setTimestamp();
}
