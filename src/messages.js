const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const db = require('./database');
const logger = require('./logger');
const { ANONYMITY_LABELS_SHORT: ANONYMITY_LABELS, getAnonymityModes, describeAnonymityModes } = require('./utils');

// Vérifie en amont que le bot a bien les permissions nécessaires pour publier
// dans un salon, plutôt que de découvrir l'échec via une DiscordAPIError.
// Retourne un tableau de libellés manquants (vide = tout est bon).
function missingSendPermissions(channel, guild) {
  const me = guild.members.me;
  if (!me) return ['Permissions inconnues (relance le bot)'];
  const perms = channel.permissionsFor(me);
  if (!perms) return ['Accès au salon'];
  const required = [
    [PermissionFlagsBits.ViewChannel, 'Voir le salon'],
    [PermissionFlagsBits.SendMessages, 'Envoyer des messages'],
    [PermissionFlagsBits.EmbedLinks, 'Intégrer des liens']
  ];
  return required.filter(([bit]) => !perms.has(bit)).map(([, label]) => label);
}

// Construit l'embed + bouton du message public d'une enquête (utilisé à la
// publication et lors des rafraîchissements de statistiques en direct).
function buildSurveyAnnouncementPayload(survey) {
  const questionCount = db.prepare('SELECT COUNT(*) c FROM questions WHERE survey_id = ?').get(survey.id).c;
  const responseCount = db.prepare('SELECT COUNT(*) c FROM responses WHERE survey_id = ?').get(survey.id).c;

  const embed = new EmbedBuilder()
    .setColor(survey.status === 'active' ? 0x5865f2 : 0x99aab5)
    .setTitle(`📋 ${survey.name}`)
    .setDescription(survey.description || 'Clique sur le bouton ci-dessous pour répondre !')
    .addFields(
      { name: 'Statut', value: survey.status === 'active' ? '🟢 Active' : '🔴 Fermée', inline: true },
      { name: 'Réponses max/util.', value: survey.max_responses_per_user === 0 ? 'Illimité' : String(survey.max_responses_per_user), inline: true },
      { name: 'Confidentialité', value: describeAnonymityModes(getAnonymityModes(survey)), inline: true },
      { name: 'Clôture', value: survey.close_at ? `<t:${Math.floor(survey.close_at / 1000)}:f>` : 'Aucune', inline: true },
      { name: 'Questions', value: String(questionCount), inline: true },
      { name: 'Réponses reçues', value: String(responseCount), inline: true }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`resp:start:${survey.id}`)
      .setLabel('Répondre')
      .setStyle(ButtonStyle.Success)
      .setEmoji('📝')
      .setDisabled(survey.status !== 'active')
  );

  return { embeds: [embed], components: [row] };
}

// Rafraîchit le message public (ex: après une nouvelle réponse) pour que les
// statistiques affichées restent à jour. Échoue silencieusement si le message
// n'existe plus (supprimé manuellement, permissions manquantes, etc.).
async function updatePublicMessageStats(client, survey) {
  if (!survey.channel_id || !survey.message_id) return;
  try {
    const channel = await client.channels.fetch(survey.channel_id);
    const message = await channel.messages.fetch(survey.message_id);
    const payload = buildSurveyAnnouncementPayload(survey);
    await message.edit(payload);
  } catch (err) {
    logger.warn(`Impossible de rafraîchir le message public de l'enquête ${survey.id}:`, err.message);
  }
}

// Poste un résumé de la réponse reçue dans le salon de réception configuré (si activé).
async function logResponseToChannel(client, survey, session) {
  const cfg = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(survey.guild_id);
  if (!cfg?.responses_log_channel_id) return;

  try {
    const channel = await client.channels.fetch(cfg.responses_log_channel_id);
    const lines = session.questions.map((q, i) => {
      const val = session.answers[i];
      const displayed = val === null || val === undefined || val === '' ? '*(pas de réponse)*' : String(val).slice(0, 150);
      return `**${q.label}**\n${displayed}`;
    });

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`📥 Nouvelle réponse : ${survey.name}`)
      .setDescription(lines.join('\n\n').slice(0, 4000))
      .addFields({ name: 'Répondant', value: session.anonymous ? '🙈 Anonyme' : `<@${session.userId}>` })
      .setTimestamp(Date.now());

    await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.warn(`Impossible de poster la réponse reçue dans le salon configuré pour l'enquête ${survey.id}:`, err.message);
  }
}

module.exports = { buildSurveyAnnouncementPayload, updatePublicMessageStats, logResponseToChannel, missingSendPermissions, ANONYMITY_LABELS };
