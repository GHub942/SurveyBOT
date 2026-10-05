require('dotenv').config();
const logger = require('./logger');
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Partials, Events, MessageFlags } = require('discord.js');

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

// Traduit les erreurs Discord les plus fréquentes (permissions manquantes en
// tête) en un message compréhensible, plutôt que de laisser remonter
// l'erreur brute à l'utilisateur.
function friendlyErrorMessage(err) {
  if (err?.code === 50013) return "❌ Il me manque une permission Discord pour faire ça (ex : Envoyer des messages / Intégrer des liens dans le salon concerné). Vérifie mes permissions puis réessaie.";
  if (err?.code === 50001) return '❌ Je n\'ai pas accès à ce salon. Vérifie que je peux le voir puis réessaie.';
  if (err?.code === 10003) return "❌ Ce salon n'existe plus.";
  if (err?.code === 10008) return "❌ Ce message n'existe plus (a probablement été supprimé).";
  return '❌ Une erreur est survenue.';
}

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
      const payload = { content: friendlyErrorMessage(err), flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  }
});

client.on(Events.GuildMemberAdd, member => {
  const { onGuildMemberAdd } = require('./events');
  onGuildMemberAdd(member).catch(err => logger.error(err));
});

// --- Robustesse : on capture tout ce qui pourrait autrement planter le
// process ou laisser une erreur passer sous le radar en silence. ---
client.on(Events.Error, err => logger.error('Erreur client Discord :', err));
client.on(Events.ShardError, err => logger.error('Erreur de shard Discord :', err));
client.on(Events.Warn, msg => logger.warn('Avertissement discord.js :', msg));
process.on('unhandledRejection', err => logger.error('Promesse rejetée non gérée :', err));
process.on('uncaughtException', err => logger.error('Exception non interceptée :', err));

if (!process.env.DISCORD_TOKEN) {
  logger.error('DISCORD_TOKEN manquant dans le fichier .env. Copie .env.example vers .env et complète-le.');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);

