const db = require('./database');

/**
 * Enregistre une action dans le journal d'audit.
 * @param {string} guildId
 * @param {string} actorId - ID de l'utilisateur à l'origine de l'action
 * @param {string} action - court identifiant, ex: 'survey.publish'
 * @param {string} [details] - texte libre, ex: "Enquête « Satisfaction »"
 */
function log(guildId, actorId, action, details = null) {
  try {
    db.prepare('INSERT INTO audit_log (guild_id, actor_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)').run(
      guildId,
      actorId,
      action,
      details,
      Date.now()
    );
  } catch (err) {
    console.error('Erreur écriture audit_log:', err);
  }
}

/** Raccourci pratique pour logger depuis une interaction Discord. */
function logFromInteraction(interaction, action, details = null) {
  const guildId = interaction.guildId || interaction.guild?.id;
  if (!guildId) return; // interactions en DM (réponses aux enquêtes) ne sont pas auditées ici
  log(guildId, interaction.user.id, action, details);
}

function getRecentLogs(guildId, limit = 15, offset = 0) {
  return db
    .prepare('SELECT * FROM audit_log WHERE guild_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(guildId, limit, offset);
}

function countLogs(guildId) {
  return db.prepare('SELECT COUNT(*) c FROM audit_log WHERE guild_id = ?').get(guildId).c;
}

const ACTION_LABELS = {
  'config.channel': '📨 Salon des réponses modifié',
  'config.whitelist.add': '👥 Ajout liste blanche',
  'config.whitelist.remove': '👥 Retrait liste blanche',
  'config.dmjoin.toggle': '👋 MP de bienvenue activé/désactivé',
  'config.dmjoin.message': '👋 Message de bienvenue modifié',
  'broadcast.sent': '📢 MP envoyé',
  'survey.create': '🆕 Enquête créée',
  'survey.publish': '🚀 Enquête publiée',
  'survey.activate': '🔓 Enquête réactivée',
  'survey.deactivate': '🔒 Enquête clôturée',
  'survey.autoclose': '⏰ Enquête clôturée automatiquement',
  'survey.delete': '🗑️ Enquête supprimée',
  'survey.duplicate': '📄 Enquête dupliquée',
  'survey.export': '📤 Export CSV',
  'question.add': '➕ Question ajoutée',
  'question.edit': '✏️ Question modifiée',
  'question.delete': '🗑️ Question supprimée',
  'data.user.delete': '🗄️ Données d\'un utilisateur supprimées',
  'data.survey.clear': '🗄️ Réponses d\'une enquête vidées'
};

module.exports = { log, logFromInteraction, getRecentLogs, countLogs, ACTION_LABELS };
