const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database');
const logs = require('./logs');
const logger = require('./logger');

const CHECK_INTERVAL_MS = 60 * 1000; // vérifie toutes les minutes

async function checkAutoClose(client) {
  const now = Date.now();
  const due = db
    .prepare("SELECT * FROM surveys WHERE status = 'active' AND close_at IS NOT NULL AND close_at <= ?")
    .all(now);

  for (const survey of due) {
    db.prepare("UPDATE surveys SET status = 'closed' WHERE id = ?").run(survey.id);
    logs.log(survey.guild_id, null, 'survey.autoclose', survey.name);

    // Désactive le bouton "Répondre" sur le message public si possible
    if (survey.channel_id && survey.message_id) {
      try {
        const channel = await client.channels.fetch(survey.channel_id);
        const message = await channel.messages.fetch(survey.message_id);
        const embed = EmbedBuilder.from(message.embeds[0]).setFooter({ text: '🔒 Enquête clôturée automatiquement' });
        const row = new ActionRowBuilder().addComponents(
          ButtonBuilder.from(message.components[0].components[0]).setDisabled(true).setLabel('Enquête clôturée')
        );
        await message.edit({ embeds: [embed], components: [row] });
      } catch (err) {
        logger.warn(`Impossible de modifier le message de l'enquête ${survey.id} lors de la clôture auto:`, err.message);
      }
    }
  }
}

function startScheduler(client) {
  setInterval(() => {
    checkAutoClose(client).catch(err => logger.error('Erreur scheduler clôture auto:', err));
  }, CHECK_INTERVAL_MS);
  // Vérifie aussi immédiatement au démarrage
  checkAutoClose(client).catch(err => logger.error('Erreur scheduler clôture auto:', err));
}

module.exports = { startScheduler };
