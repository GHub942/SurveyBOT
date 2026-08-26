require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const commands = [];
const commandsPath = path.join(__dirname, 'src', 'commands');
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    if (!process.env.CLIENT_ID) {
      throw new Error('CLIENT_ID manquant dans le fichier .env');
    }

    if (process.env.GUILD_ID) {
      // Déploiement instantané sur un seul serveur (pratique en dev)
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), {
        body: commands
      });
      console.log(`✅ ${commands.length} commande(s) déployée(s) sur le serveur ${process.env.GUILD_ID}.`);
    } else {
      // Déploiement global (jusqu'à 1h de propagation)
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
      console.log(`✅ ${commands.length} commande(s) déployée(s) globalement.`);
    }
  } catch (err) {
    console.error(err);
  }
})();
