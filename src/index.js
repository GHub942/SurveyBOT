require('dotenv').config();
const logger = require('./logger');
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Partials, Events } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

client.once(Events.ClientReady, c => {
  console.log(`✅ Connecté en tant que ${c.user.tag} (logs: ${logger.level})`);
  const { startScheduler } = require('./scheduler');
  startScheduler(c);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
    } else if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) await command.autocomplete(interaction);
    } else {
      const { handle } = require('./interactions');
      await handle(interaction);
    }
  } catch (err) {
    logger.error(err);
    if (interaction.isRepliable && interaction.isRepliable()) {
      const payload = { content: '❌ Une erreur est survenue.', ephemeral: true };
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  }
});

client.on(Events.GuildMemberAdd, member => {
  const { onGuildMemberAdd } = require('./events');
  onGuildMemberAdd(member).catch(err => logger.error(err));
});

if (!process.env.DISCORD_TOKEN) {
  logger.error('DISCORD_TOKEN manquant dans le fichier .env. Copie .env.example vers .env et complète-le.');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
