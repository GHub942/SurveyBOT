const { PermissionFlagsBits } = require('discord.js');
const db = require('./database');

// Sessions de construction d'enquête (builder) : clé = `${userId}:${guildId}`
// valeur = { surveyId }
const builderSessions = new Map();

// Sessions de ciblage du broadcast MP : clé = userId
// valeur = { type: 'all' } | { type: 'role', roleId } | { type: 'users', userIds: [] }
const broadcastTargets = new Map();

// Brouillon de question en cours de création/édition : clé = `${userId}:${surveyId}`
// valeur = { mode: 'add'|'edit', questionId?, type?, required?, label?, options? }
const questionDrafts = new Map();

// Messages pré-remplis proposés lors de l'envoi d'un MP (broadcast ou bienvenue)
const DM_PRESETS = [
  {
    id: 'p1',
    label: 'Amical',
    text: "👋 Salut ! Nous avons une enquête en cours sur le serveur, ça ne prend qu'une minute : clique sur le bouton **Répondre** ci-dessous pour donner ton avis !"
  },
  {
    id: 'p2',
    label: 'Formel',
    text: 'Bonjour,\n\nUne enquête est actuellement disponible sur le serveur. Nous vous invitons à y répondre via le bouton « Répondre » ci-dessous. Votre avis compte beaucoup pour nous.\n\nMerci d\'avance !'
  },
  {
    id: 'p3',
    label: 'Rappel',
    text: '⏰ Petit rappel : une enquête attend toujours ta réponse ! Clique sur **Répondre** ci-dessous, ça ne prend que 2 minutes 🙂'
  }
];

const ANONYMITY_LABELS = {
  non: '🙂 Non anonyme',
  choix: '🎭 Anonymat au choix du membre',
  oui: '🙈 Anonyme total'
};

function isAuthorized(interaction) {
  if (interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const row = db
    .prepare('SELECT 1 FROM whitelist WHERE guild_id = ? AND user_id = ?')
    .get(interaction.guildId, interaction.user.id);
  return !!row;
}

function toCsvValue(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/"/g, '""');
  return `"${s}"`;
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

// Parse une date au format "JJ/MM/AAAA HH:MM" -> timestamp ms, ou null si invalide
function parseDateTimeFR(input) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,T]+(\d{1,2}):(\d{2})$/.exec((input || '').trim());
  if (!m) return null;
  const [d, mo, y, h, mi] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  // Rejette les dates "qui débordent" (ex: 32/13/2027) que JS arrondirait silencieusement
  if (date.getDate() !== d || date.getMonth() !== mo - 1 || date.getFullYear() !== y || date.getHours() !== h || date.getMinutes() !== mi) {
    return null;
  }
  return date.getTime();
}

// Rendu d'une petite jauge textuelle (façon graphique) pour les questions à choix
function renderBar(pct, width = 14) {
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(Math.max(0, Math.min(width, filled))) + '░'.repeat(Math.max(0, width - filled));
}

module.exports = {
  builderSessions,
  broadcastTargets,
  questionDrafts,
  DM_PRESETS,
  ANONYMITY_LABELS,
  isAuthorized,
  toCsvValue,
  chunk,
  parseDateTimeFR,
  renderBar
};
