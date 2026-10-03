// Utilise le module SQLite intégré à Node.js (node:sqlite) : aucune compilation
// native requise (contrairement à better-sqlite3), donc pas besoin de Visual
// Studio / build tools sous Windows.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, '..', 'data.sqlite'));
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS guild_config (
  guild_id TEXT PRIMARY KEY,
  response_channel_id TEXT,
  dm_on_join INTEGER DEFAULT 0,
  dm_on_join_message TEXT
);

CREATE TABLE IF NOT EXISTS whitelist (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS surveys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  channel_id TEXT,
  message_id TEXT,
  max_responses_per_user INTEGER DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',       -- draft | active | closed
  anonymity_mode TEXT NOT NULL DEFAULT 'semi', -- public | semi | private | choice
  close_at INTEGER,                            -- timestamp ms, NULL = pas de clôture auto
  created_by TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL,      -- texte | nombre | choix
  options TEXT,            -- JSON array pour le type "choix"
  required INTEGER DEFAULT 1,
  multiline INTEGER DEFAULT 1,  -- type "texte" : 1 = plusieurs lignes, 0 = une seule ligne
  min_value REAL,                -- type "nombre" : borne basse (NULL = illimité)
  max_value REAL,                -- type "nombre" : borne haute (NULL = illimité)
  min_select INTEGER DEFAULT 1,  -- type "choix" : nombre minimum d'options à sélectionner
  max_select INTEGER DEFAULT 1   -- type "choix" : nombre maximum d'options à sélectionner
);

CREATE TABLE IF NOT EXISTS responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,        -- 'anonymous' si réponse anonyme
  is_anonymous INTEGER DEFAULT 0,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  response_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  value TEXT
);

-- Sessions de réponse persistées (survit à un redémarrage du bot)
CREATE TABLE IF NOT EXISTS response_sessions (
  survey_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  current_index INTEGER NOT NULL DEFAULT 0,
  answers TEXT NOT NULL DEFAULT '[]',
  anonymous INTEGER,   -- NULL = pas encore choisi (mode "choix"), sinon 0/1
  updated_at INTEGER,
  PRIMARY KEY (survey_id, user_id)
);

-- Journal d'audit (qui a fait quoi, quand)
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  details TEXT,
  created_at INTEGER
);

-- Permissions granulaires par utilisateur (en plus de "Gérer le serveur" qui donne tout accès)
CREATE TABLE IF NOT EXISTS permissions (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  perm TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id, perm)
);

-- Restrictions de ciblage pour la permission "manage_mp" : si un utilisateur n'a AUCUNE
-- ligne ici, il n'a aucune restriction (peut cibler n'importe quel rôle/membre). Dès qu'il
-- a au moins une ligne d'un type donné, il ne peut cibler que ce qui est listé pour ce type.
CREATE TABLE IF NOT EXISTS mp_restrictions (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  target_type TEXT NOT NULL, -- 'role' | 'user'
  target_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id, target_type, target_id)
);

-- Membres bloqués : empêche la gestion en libre-service de leurs propres
-- réponses (mode utilisateur du /dashboard) tant qu'ils sont listés ici.
CREATE TABLE IF NOT EXISTS blocked_users (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
`);

// --- Migrations légères pour les bases déjà existantes (avant cette mise à jour) ---
// SQLite ne supporte pas "ADD COLUMN IF NOT EXISTS" de façon portable ici,
// donc on tente l'ALTER TABLE et on ignore l'erreur si la colonne existe déjà.
function safeAlter(sql) {
  try {
    db.exec(sql);
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }
}
safeAlter("ALTER TABLE surveys ADD COLUMN anonymity_mode TEXT NOT NULL DEFAULT 'non'");
safeAlter('ALTER TABLE surveys ADD COLUMN close_at INTEGER');
safeAlter('ALTER TABLE responses ADD COLUMN is_anonymous INTEGER DEFAULT 0');
safeAlter('ALTER TABLE questions ADD COLUMN multiline INTEGER DEFAULT 1');
safeAlter('ALTER TABLE questions ADD COLUMN min_value REAL');
safeAlter('ALTER TABLE questions ADD COLUMN max_value REAL');
safeAlter('ALTER TABLE questions ADD COLUMN min_select INTEGER DEFAULT 1');
safeAlter('ALTER TABLE questions ADD COLUMN max_select INTEGER DEFAULT 1');
safeAlter('ALTER TABLE guild_config ADD COLUMN responses_log_channel_id TEXT');
safeAlter('ALTER TABLE response_sessions ADD COLUMN preview INTEGER DEFAULT 0');
safeAlter('ALTER TABLE responses ADD COLUMN is_public INTEGER');
safeAlter('ALTER TABLE response_sessions ADD COLUMN is_public INTEGER');
// Option par enquête : autoriser un membre à supprimer lui-même sa réponse
// sans passer par un admin (activée par défaut sur les enquêtes existantes).
safeAlter('ALTER TABLE surveys ADD COLUMN allow_self_delete INTEGER DEFAULT 1');
// Option par enquête : autoriser un membre à modifier lui-même sa réponse.
safeAlter('ALTER TABLE surveys ADD COLUMN allow_self_edit INTEGER DEFAULT 1');
// Archivage : une enquête archivée ne compte plus dans les statistiques, ses
// réponses restent lisibles mais plus aucune modification (enquête ou
// réponses membre) n'est possible tant qu'elle n'est pas désarchivée. La
// suppression définitive n'est possible qu'une fois l'enquête archivée.
safeAlter('ALTER TABLE surveys ADD COLUMN archived INTEGER DEFAULT 0');
safeAlter('ALTER TABLE surveys ADD COLUMN archived_at INTEGER');
// Sessions de réponse : indique qu'il s'agit d'une modification d'une réponse
// existante (mode utilisateur) plutôt que d'un premier envoi.
safeAlter('ALTER TABLE response_sessions ADD COLUMN edit_mode INTEGER DEFAULT 0');

// Migration des anciennes valeurs d'anonymat vers les 4 nouveaux modes de confidentialité :
// non -> semi (visible du staff uniquement) | choix -> choice (au choix : public/semi) | oui -> private (anonyme, réponses illimitées)
db.exec(`
  UPDATE surveys SET anonymity_mode = 'semi' WHERE anonymity_mode = 'non';
  UPDATE surveys SET anonymity_mode = 'choice' WHERE anonymity_mode = 'choix';
  UPDATE surveys SET anonymity_mode = 'private' WHERE anonymity_mode = 'oui';
`);

module.exports = db;
