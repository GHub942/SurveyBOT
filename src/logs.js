const db = require('./database');
const logger = require('./logger');

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
    logger.error('Erreur écriture audit_log:', err);
  }
}

/** Raccourci pratique pour logger depuis une interaction Discord. */
function logFromInteraction(interaction, action, details = null) {
  const guildId = interaction.guildId || interaction.guild?.id;
  if (!guildId) return; // interactions en DM (réponses aux enquêtes) ne sont pas auditées ici
  log(guildId, interaction.user.id, action, details);
}

function getRecentLogs(guildId, limit = 15, offset = 0, filters = {}) {
  const clauses = ['guild_id = ?'];
  const params = [guildId];
  if (filters.actorIds && filters.actorIds.length) {
    clauses.push(`actor_id IN (${filters.actorIds.map(() => '?').join(',')})`);
    params.push(...filters.actorIds);
  }
  if (filters.actions && filters.actions.length) {
    clauses.push(`action IN (${filters.actions.map(() => '?').join(',')})`);
    params.push(...filters.actions);
  }
  return db.prepare(`SELECT * FROM audit_log WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
}

function countLogs(guildId, filters = {}) {
  const clauses = ['guild_id = ?'];
  const params = [guildId];
  if (filters.actorIds && filters.actorIds.length) {
    clauses.push(`actor_id IN (${filters.actorIds.map(() => '?').join(',')})`);
    params.push(...filters.actorIds);
  }
  if (filters.actions && filters.actions.length) {
    clauses.push(`action IN (${filters.actions.map(() => '?').join(',')})`);
    params.push(...filters.actions);
  }
  return db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE ${clauses.join(' AND ')}`).get(...params).c;
}

function getDistinctActions(guildId) {
  return db.prepare('SELECT DISTINCT action FROM audit_log WHERE guild_id = ? ORDER BY action').all(guildId).map(r => r.action);
}

const ACTION_LABELS = {
  'config.channel': '📨 Salon des réponses modifié',
  'config.dmjoin.toggle': '👋 MP de bienvenue activé/désactivé',
  'config.dmjoin.message': '👋 Message de bienvenue modifié',
  'broadcast.sent': '📢 MP envoyé',
  'survey.create': '🆕 Enquête créée',
  'survey.edit': '✏️ Enquête modifiée',
  'survey.publish': '🚀 Enquête publiée',
  'survey.activate': '🔓 Enquête réactivée',
  'survey.deactivate': '🔒 Enquête clôturée',
  'survey.autoclose': '⏰ Enquête clôturée automatiquement',
  'survey.delete': '🗑️ Enquête supprimée',
  'survey.duplicate': '📄 Enquête dupliquée',
  'survey.export': '📤 Export effectué',
  'question.add': '➕ Question ajoutée',
  'question.edit': '✏️ Question modifiée',
  'question.delete': '🗑️ Question supprimée',
  'data.user.delete': '🗄️ Données d\'un utilisateur supprimées',
  'data.user.view': '📄 Réponses d\'un utilisateur consultées',
  'data.survey.clear': '🗄️ Réponses d\'une enquête vidées',
  'permissions.toggle': '🔑 Permission modifiée',
  'permissions.mprestrict': '🎯 Restriction de cible MP modifiée',
  'permissions.block': '🚫 Blocage d\'un membre modifié',
  'data.selfdelete': '🗑️ Réponse supprimée par le membre lui-même',
  'data.selfedit': '✏️ Réponse modifiée par le membre lui-même',
  'survey.selfdelete.toggle': '🔧 Option de suppression en libre-service modifiée',
  'survey.selfedit.toggle': '🔧 Option de modification en libre-service modifiée',
  'survey.archive': '🗄️ Enquête archivée',
  'survey.unarchive': '📤 Enquête désarchivée',
  'survey.raffle': '🎲 Tirage au sort effectué',
  'survey.restore': '📥 Enquête restaurée depuis une sauvegarde',
  'reminder.sent': '⏰ Rappel automatique envoyé'
};

module.exports = { log, logFromInteraction, getRecentLogs, countLogs, getDistinctActions, ACTION_LABELS };
