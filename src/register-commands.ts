import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commandDefinitions } from './commands/definitions';

async function main() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token || !clientId) {
    console.error('DISCORD_TOKEN und DISCORD_CLIENT_ID müssen gesetzt sein.');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(token);

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commandDefinitions,
    });
    console.log(`Slash-Commands für Guild ${guildId} registriert.`);
  } else {
    await rest.put(Routes.applicationCommands(clientId), {
      body: commandDefinitions,
    });
    console.log('Slash-Commands global registriert (kann bis zu 1h dauern).');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
