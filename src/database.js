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
  anonymity_mode TEXT NOT NULL DEFAULT 'non', -- non | choix | oui
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
  required INTEGER DEFAULT 1
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

module.exports = db;
