// Utilitaire unique pour gérer les commandes slash globales/serveur :
//   node src/scripts/commands.js deploy   -> (ré)enregistre /dashboard et /enquete
//   node src/scripts/commands.js clear    -> supprime toutes les commandes enregistrées
//
// Remplace les anciens deploy-commands.js et clear-commands.js à la racine
// (fusionnés ici pour ne garder qu'un seul fichier utilitaire, rangé dans src/).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const action = process.argv[2];
if (!['deploy', 'clear'].includes(action)) {
  console.error('Usage : node src/scripts/commands.js <deploy|clear>');
  process.exit(1);
}

if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN manquant dans le fichier .env');
if (!process.env.CLIENT_ID) throw new Error('CLIENT_ID manquant dans le fichier .env');

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function deploy() {
  const commandsPath = path.join(__dirname, '..', 'commands');
  const commands = fs
    .readdirSync(commandsPath)
    .filter(f => f.endsWith('.js'))
    .map(f => require(path.join(commandsPath, f)).data.toJSON());

  if (process.env.GUILD_ID) {
    const data = await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log(`✅ ${data.length} commande(s) déployée(s) sur le serveur ${process.env.GUILD_ID}.`);
  } else {
    const data = await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log(`✅ ${data.length} commande(s) déployée(s) globalement (peut prendre jusqu'à 1h à se propager).`);
  }
}

async function clear() {
  console.log('🧹 Suppression de TOUTES les commandes globales...');
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
  console.log('✅ Commandes globales supprimées.');

  if (process.env.GUILD_ID) {
    console.log(`🧹 Suppression de TOUTES les commandes du serveur ${process.env.GUILD_ID}...`);
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [] });
    console.log('✅ Commandes du serveur supprimées.');
  } else {
    console.log("ℹ️ GUILD_ID vide dans .env : remplis-le temporairement si tu as aussi des commandes");
    console.log('   déployées sur un serveur précis, relance ce script, puis remets-le à sa valeur d\'origine.');
  }
  console.log('\n🚀 Nettoyage terminé. Lance maintenant "npm run deploy" pour redéployer proprement.');
}

(action === 'deploy' ? deploy() : clear()).catch(err => {
  console.error(err);
  process.exit(1);
});
