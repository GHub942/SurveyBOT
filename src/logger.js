// Logger minimaliste : par défaut seuls les erreurs et avertissements sont
// affichés (LOG_LEVEL=warn). Positionner LOG_LEVEL=debug (ou =info) au
// démarrage pour voir davantage de détails — géré par quickstart.bat.
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[(process.env.LOG_LEVEL || 'warn').toLowerCase()] ?? LEVELS.warn;

const PREFIX = { error: '❌', warn: '⚠️ ', info: 'ℹ️ ', debug: '🔍' };

function log(level, ...args) {
  if (LEVELS[level] > currentLevel) return;
  const out = level === 'error' ? console.error : console.log;
  out(PREFIX[level], ...args);
}

module.exports = {
  error: (...args) => log('error', ...args),
  warn: (...args) => log('warn', ...args),
  info: (...args) => log('info', ...args),
  debug: (...args) => log('debug', ...args),
  level: Object.keys(LEVELS).find(k => LEVELS[k] === currentLevel)
};
