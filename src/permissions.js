const { PermissionFlagsBits } = require('discord.js');
const db = require('./database');

const PERMS = {
  MANAGE_SURVEYS: 'manage_surveys',
  MP_ALL: 'mp_all',
  MANAGE_MP: 'manage_mp',
  MANAGE_MP_WELCOME: 'manage_mp_welcome',
  VIEW_LOGS: 'view_logs',
  MANAGE_DATA: 'manage_data'
};

const PERM_LABELS = {
  manage_surveys: '📋 Gérer les enquêtes',
  mp_all: '📢 MP à tous les membres',
  manage_mp: '✉️ Gérer les MP ciblés',
  manage_mp_welcome: '👋 Gérer les MP de bienvenue',
  view_logs: '📜 Voir les logs',
  manage_data: '🗄️ Gérer la base de données'
};

const ALL_PERMS = Object.values(PERMS);

// Un membre avec la permission Discord "Gérer le serveur" a accès à tout, sans exception.
function isServerManager(interaction) {
  return !!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
}

function hasPerm(interaction, perm) {
  if (isServerManager(interaction)) return true;
  const row = db
    .prepare('SELECT 1 FROM permissions WHERE guild_id = ? AND user_id = ? AND perm = ?')
    .get(interaction.guildId, interaction.user.id, perm);
  return !!row;
}

function hasAnyPerm(interaction) {
  if (isServerManager(interaction)) return true;
  const row = db.prepare('SELECT 1 FROM permissions WHERE guild_id = ? AND user_id = ? LIMIT 1').get(interaction.guildId, interaction.user.id);
  return !!row;
}

function getUserPerms(guildId, userId) {
  return db.prepare('SELECT perm FROM permissions WHERE guild_id = ? AND user_id = ?').all(guildId, userId).map(r => r.perm);
}

function getUsersWithAnyPerm(guildId) {
  return db.prepare('SELECT DISTINCT user_id FROM permissions WHERE guild_id = ?').all(guildId).map(r => r.user_id);
}

function grantPerm(guildId, userId, perm) {
  db.prepare('INSERT OR IGNORE INTO permissions (guild_id, user_id, perm) VALUES (?, ?, ?)').run(guildId, userId, perm);
}

function revokePerm(guildId, userId, perm) {
  db.prepare('DELETE FROM permissions WHERE guild_id = ? AND user_id = ? AND perm = ?').run(guildId, userId, perm);
}

function togglePerm(guildId, userId, perm) {
  const has = db.prepare('SELECT 1 FROM permissions WHERE guild_id = ? AND user_id = ? AND perm = ?').get(guildId, userId, perm);
  if (has) revokePerm(guildId, userId, perm);
  else grantPerm(guildId, userId, perm);
  return !has;
}

/* --------- Restrictions de ciblage pour la permission "manage_mp" --------- */

function getMpRestrictions(guildId, userId) {
  return db.prepare('SELECT target_type, target_id FROM mp_restrictions WHERE guild_id = ? AND user_id = ?').all(guildId, userId);
}

function addMpRestriction(guildId, userId, type, id) {
  db.prepare('INSERT OR IGNORE INTO mp_restrictions (guild_id, user_id, target_type, target_id) VALUES (?, ?, ?, ?)').run(guildId, userId, type, id);
}

function removeMpRestriction(guildId, userId, type, id) {
  db.prepare('DELETE FROM mp_restrictions WHERE guild_id = ? AND user_id = ? AND target_type = ? AND target_id = ?').run(guildId, userId, type, id);
}

// Vérifie que les cibles choisies (rôle ou utilisateurs) sont autorisées pour ce membre.
// Retourne { ok: true } ou { ok: false, notAllowed: [...] }.
function validateMpTarget(interaction, type, ids) {
  if (isServerManager(interaction) || hasPerm(interaction, PERMS.MP_ALL)) return { ok: true };
  const restrictions = getMpRestrictions(interaction.guildId, interaction.user.id);
  const allowedOfType = restrictions.filter(r => r.target_type === type).map(r => r.target_id);
  if (allowedOfType.length === 0) return { ok: true }; // aucune restriction définie pour ce type -> autorisé
  const notAllowed = ids.filter(id => !allowedOfType.includes(id));
  if (notAllowed.length) return { ok: false, notAllowed };
  return { ok: true };
}

/* --------- Blocage d'un membre (mode utilisateur du /dashboard) --------- */
// Un membre bloqué ne peut plus gérer lui-même ses réponses (suppression en
// libre-service) : il doit passer par un responsable ayant "manage_data".

function isBlocked(guildId, userId) {
  return !!db.prepare('SELECT 1 FROM blocked_users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
}

function blockUser(guildId, userId) {
  db.prepare('INSERT OR IGNORE INTO blocked_users (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
}

function unblockUser(guildId, userId) {
  db.prepare('DELETE FROM blocked_users WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

function toggleBlock(guildId, userId) {
  const blocked = isBlocked(guildId, userId);
  if (blocked) unblockUser(guildId, userId);
  else blockUser(guildId, userId);
  return !blocked;
}

module.exports = {
  PERMS,
  PERM_LABELS,
  ALL_PERMS,
  isServerManager,
  hasPerm,
  hasAnyPerm,
  getUserPerms,
  getUsersWithAnyPerm,
  grantPerm,
  revokePerm,
  togglePerm,
  getMpRestrictions,
  addMpRestriction,
  removeMpRestriction,
  validateMpTarget,
  isBlocked,
  blockUser,
  unblockUser,
  toggleBlock
};
