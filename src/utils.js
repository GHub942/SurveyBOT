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
  public: '🌐 Publique (nom visible dans les stats)',
  semi: '🛡️ Semi-privé (nom visible du staff uniquement)',
  private: '🙈 Privé (anonyme, réponses illimitées)',
  choice: '🎭 Au choix (Publique ou Semi-privé)'
};

// Libellés courts, utilisés là où l'espace est limité (embeds, footers)
const ANONYMITY_LABELS_SHORT = {
  public: '🌐 Publique',
  semi: '🛡️ Semi-privé',
  private: '🙈 Privé',
  choice: '🎭 Au choix'
};

// Brouillons de MP en attente de confirmation : clé = userId
// valeur = { target, message, recipientsPreview }
const broadcastDrafts = new Map();

// Filtres actifs du journal d'audit par utilisateur consultant le panneau : clé = userId
// valeur = { actorId?, action? }
const logFilters = new Map();

// Modèles d'enquêtes prêts à l'emploi, proposés à la création
const SURVEY_TEMPLATES = {
  blank: { label: 'Vierge', emoji: '📄', name: '', description: '', max: '1', questions: [] },
  satisfaction: {
    label: 'Satisfaction',
    emoji: '😊',
    name: 'Satisfaction générale',
    description: 'Merci de nous donner votre avis sur votre expérience sur le serveur.',
    max: '1',
    questions: [
      { label: 'Comment évaluez-vous votre satisfaction générale ?', type: 'choix', options: ['Très satisfait', 'Satisfait', 'Neutre', 'Insatisfait', 'Très insatisfait'], required: 1 },
      { label: "Avez-vous des suggestions d'amélioration ?", type: 'texte', required: 0 }
    ]
  },
  event: {
    label: 'Feedback événement',
    emoji: '🎉',
    name: 'Feedback événement',
    description: "Ton avis sur l'événement nous intéresse !",
    max: '1',
    questions: [
      { label: 'Note globale sur 10 ?', type: 'nombre', required: 1 },
      { label: 'Ce que tu as le plus apprécié ?', type: 'texte', required: 0 },
      { label: "Ce qu'on pourrait améliorer la prochaine fois ?", type: 'texte', required: 0 }
    ]
  },
  quick: {
    label: 'Sondage rapide',
    emoji: '⚡',
    name: 'Sondage rapide',
    description: '',
    max: '1',
    questions: [{ label: 'Es-tu pour ou contre ?', type: 'choix', options: ['Pour', 'Contre', 'Neutre'], required: 1 }]
  },
  recrutement: {
    label: 'Candidature staff',
    emoji: '🧑‍💼',
    name: 'Candidature staff',
    description: 'Merci de répondre à ces quelques questions pour ta candidature.',
    max: '1',
    questions: [
      { label: 'Quel âge as-tu ?', type: 'nombre', required: 1 },
      { label: 'Depuis quand es-tu sur le serveur ?', type: 'texte', required: 1 },
      { label: 'Pourquoi souhaites-tu rejoindre le staff ?', type: 'texte', required: 1 },
      { label: 'Combien de temps peux-tu consacrer par semaine ?', type: 'texte', required: 0 }
    ]
  }
};

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

// Discord limite la valeur d'un champ d'embed à 1024 caractères : toute valeur
// dynamique (liste de questions, options, etc.) doit passer par cette fonction
// avant d'être utilisée dans un .addFields(), sous peine de crash silencieux.
function truncateField(text, max = 1024) {
  if (!text) return text;
  if (text.length <= max) return text;
  const suffix = '\n… (tronqué)';
  return text.slice(0, max - suffix.length) + suffix;
}

// Remplace les variables {user}, {userMention}, etc. dans un message MP.
// ctx: { username, userId, surveyName, surveyId, surveyPrivacy, serverName }
const MP_VARIABLES = ['{user}', '{userMention}', '{userId}', '{surveyName}', '{surveyId}', '{surveyPrivacy}', '{serverName}'];

function substituteVariables(text, ctx = {}) {
  const map = {
    '{user}': ctx.username || '',
    '{userMention}': ctx.userId ? `<@${ctx.userId}>` : '',
    '{userId}': ctx.userId || '',
    '{surveyName}': ctx.surveyName || '',
    '{surveyId}': ctx.surveyId != null ? String(ctx.surveyId) : '',
    '{surveyPrivacy}': ctx.surveyPrivacy || '',
    '{serverName}': ctx.serverName || ''
  };
  let out = text;
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
  return out;
}

module.exports = {
  builderSessions,
  broadcastTargets,
  broadcastDrafts,
  logFilters,
  questionDrafts,
  DM_PRESETS,
  ANONYMITY_LABELS,
  ANONYMITY_LABELS_SHORT,
  SURVEY_TEMPLATES,
  toCsvValue,
  chunk,
  parseDateTimeFR,
  renderBar,
  truncateField,
  substituteVariables,
  MP_VARIABLES
};
