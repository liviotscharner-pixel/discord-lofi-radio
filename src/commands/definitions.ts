import { SlashCommandBuilder } from 'discord.js';
import { STATION_CHOICES } from '../stations';

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('radio')
    .setDescription('Tritt dem Voice-Channel bei und spielt einen Lofi-Sender')
    .addStringOption((opt) =>
      opt
        .setName('station')
        .setDescription('Welcher Sender?')
        .setRequired(true)
        .addChoices(
          ...STATION_CHOICES.map((c) => ({ name: c.name, value: c.value })),
        ),
    ),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stoppt die Wiedergabe und verlässt den Voice-Channel'),
  new SlashCommandBuilder()
    .setName('now')
    .setDescription('Zeigt den aktuell laufenden Sender'),
].map((c) => c.toJSON());
