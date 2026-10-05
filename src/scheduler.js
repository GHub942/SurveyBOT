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

// Rappels automatiques : MP aux membres n'ayant pas encore répondu (de façon
// identifiée), X minutes avant la clôture programmée d'une enquête.
async function checkReminders(client) {
  const now = Date.now();
  const due = db
    .prepare(
      `SELECT * FROM surveys
       WHERE status = 'active' AND close_at IS NOT NULL AND reminder_minutes_before IS NOT NULL
       AND reminder_sent_at IS NULL AND close_at > ? AND close_at - (reminder_minutes_before * 60000) <= ?`
    )
    .all(now, now);

  for (const survey of due) {
    // Marqué "envoyé" tout de suite pour ne jamais relancer deux fois, même
    // si l'envoi échoue partiellement en cours de route.
    db.prepare('UPDATE surveys SET reminder_sent_at = ? WHERE id = ?').run(now, survey.id);

    const guild = await client.guilds.fetch(survey.guild_id).catch(() => null);
    if (!guild) continue;

    try {
      await guild.members.fetch(); // peuple le cache ; nécessaire pour lister tout le monde
    } catch (err) {
      logger.warn(`Rappel : impossible de récupérer la liste des membres du serveur ${survey.guild_id}:`, err.message);
      continue;
    }

    const answeredIds = new Set(
      db.prepare('SELECT DISTINCT user_id FROM responses WHERE survey_id = ? AND is_anonymous = 0').all(survey.id).map(r => r.user_id)
    );

    const embed = new EmbedBuilder()
      .setColor(0xfaa61a)
      .setTitle('⏰ Une enquête se termine bientôt !')
      .setDescription(`L'enquête **${survey.name}** sur **${guild.name}** se termine <t:${Math.floor(survey.close_at / 1000)}:R> et tu n'y as pas encore répondu.`);
    const components =
      survey.channel_id && survey.message_id
        ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Voir l'enquête").setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${survey.guild_id}/${survey.channel_id}/${survey.message_id}`))]
        : [];

    let sent = 0;
    for (const [, member] of guild.members.cache) {
      if (member.user.bot || answeredIds.has(member.id)) continue;
      try {
        await member.send({ embeds: [embed], components });
        sent++;
      } catch {
        // MP fermés ou membre injoignable : on ignore silencieusement et on continue.
      }
    }
    logs.log(survey.guild_id, null, 'reminder.sent', `${survey.name} (${sent} membre(s) relancé(s))`);
  }
}

function startScheduler(client) {
  setInterval(() => {
    checkAutoClose(client).catch(err => logger.error('Erreur scheduler clôture auto:', err));
    checkReminders(client).catch(err => logger.error('Erreur scheduler rappels:', err));
  }, CHECK_INTERVAL_MS);
  // Vérifie aussi immédiatement au démarrage
  checkAutoClose(client).catch(err => logger.error('Erreur scheduler clôture auto:', err));
  checkReminders(client).catch(err => logger.error('Erreur scheduler rappels:', err));
}

module.exports = { startScheduler, checkAutoClose, checkReminders };
