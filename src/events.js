const db = require('./database');
const { buildDmComponents } = require('./panels');

async function onGuildMemberAdd(member) {
  if (member.user.bot) return;

  const cfg = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(member.guild.id);
  if (!cfg || !cfg.dm_on_join) return;

  const activeSurveys = db
    .prepare("SELECT name FROM surveys WHERE guild_id = ? AND status = 'active'")
    .all(member.guild.id);

  let message = cfg.dm_on_join_message || `Bienvenue sur ${member.guild.name} ! N'hésite pas à répondre à nos enquêtes en cours avec /enquete 🙂`;

  if (activeSurveys.length) {
    message += `\n\n📋 Enquête(s) en cours : ${activeSurveys.map(s => `**${s.name}**`).join(', ')}`;
  }

  try {
    const components = buildDmComponents(member.guild);
    await member.send({ content: message, components });
  } catch {
    // MP fermés, on ignore silencieusement
  }
}

module.exports = { onGuildMemberAdd };
