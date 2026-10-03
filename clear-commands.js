require('dotenv').config();
const { REST, Routes } = require('discord.js');

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  if (!process.env.CLIENT_ID) throw new Error('CLIENT_ID manquant dans le fichier .env');

  console.log('🧹 Suppression de TOUTES les commandes globales...');
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
  console.log('✅ Commandes globales supprimées.');

  if (process.env.GUILD_ID) {
    console.log(`🧹 Suppression de TOUTES les commandes du serveur ${process.env.GUILD_ID}...`);
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [] });
    console.log('✅ Commandes du serveur supprimées.');
  } else {
    console.log('ℹ️ GUILD_ID vide dans .env : si tu as aussi des commandes déployées sur un serveur précis,');
    console.log('   remplis temporairement GUILD_ID dans .env avec l\'ID de ce serveur, relance ce script,');
    console.log('   puis remets GUILD_ID à sa valeur d\'origine.');
  }

  console.log('\n🚀 Nettoyage terminé. Lance maintenant "npm run deploy" pour redéployer proprement /dashboard et /enquete.');
})().catch(console.error);
