const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const db = require('./database');

/* ------------------------------------------------------------------ */
/*  Sessions de réponse — persistées en base (survivent à un redémarrage)*/
/* ------------------------------------------------------------------ */

function loadSession(surveyId, userId) {
  const row = db.prepare('SELECT * FROM response_sessions WHERE survey_id = ? AND user_id = ?').get(surveyId, userId);
  if (!row) return null;
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const questions = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position ASC').all(surveyId);
  return {
    survey,
    questions,
    userId,
    index: row.current_index,
    answers: JSON.parse(row.answers),
    anonymous: row.anonymous === null || row.anonymous === undefined ? null : !!row.anonymous
  };
}

function saveSession(session) {
  db.prepare(
    `INSERT INTO response_sessions (survey_id, user_id, current_index, answers, anonymous, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(survey_id, user_id) DO UPDATE SET
       current_index = excluded.current_index,
       answers = excluded.answers,
       anonymous = excluded.anonymous,
       updated_at = excluded.updated_at`
  ).run(
    session.survey.id,
    session.userId,
    session.index,
    JSON.stringify(session.answers),
    session.anonymous === null ? null : session.anonymous ? 1 : 0,
    Date.now()
  );
}

function clearSession(surveyId, userId) {
  db.prepare('DELETE FROM response_sessions WHERE survey_id = ? AND user_id = ?').run(surveyId, userId);
}

/* ------------------------------------------------------------------ */
/*  Limite de réponses par utilisateur                                  */
/* ------------------------------------------------------------------ */

function alreadyMaxedOut(survey, userId) {
  if (!survey.max_responses_per_user || survey.max_responses_per_user === 0) return false;
  // Les réponses anonymes ne peuvent pas être rattachées à un utilisateur :
  // la limite ne peut donc être garantie que pour les réponses non-anonymes.
  const count = db
    .prepare("SELECT COUNT(*) c FROM responses WHERE survey_id = ? AND user_id = ? AND is_anonymous = 0")
    .get(survey.id, userId).c;
  return count >= survey.max_responses_per_user;
}

/* ------------------------------------------------------------------ */
/*  Rendu des étapes (choix d'anonymat, question, fin)                  */
/* ------------------------------------------------------------------ */

function renderAnonymityStep(session) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📝 ${session.survey.name}`)
    .setDescription("Cette enquête te permet de répondre **anonymement** si tu le souhaites.\nComment veux-tu répondre ?");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`resp:anon:${session.survey.id}:oui`).setLabel('Répondre anonymement').setStyle(ButtonStyle.Secondary).setEmoji('🙈'),
    new ButtonBuilder().setCustomId(`resp:anon:${session.survey.id}:non`).setLabel('Répondre avec mon pseudo').setStyle(ButtonStyle.Primary).setEmoji('🙂')
  );

  return { embeds: [embed], components: [row] };
}

function renderQuestion(session) {
  const q = session.questions[session.index];
  const progress = `Question ${session.index + 1} / ${session.questions.length}`;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📝 ${session.survey.name}`)
    .setDescription(`**${q.label}**${q.required ? '' : ' *(optionnel)*'}`)
    .setFooter({ text: session.anonymous ? `${progress} • réponse anonyme` : progress });

  let components;
  if (q.type === 'choix') {
    const options = JSON.parse(q.options || '[]');
    const select = new StringSelectMenuBuilder()
      .setCustomId(`resp:select:${session.survey.id}`)
      .setPlaceholder('Choisis une réponse')
      .addOptions(options.slice(0, 25).map(o => ({ label: o.slice(0, 100), value: o.slice(0, 100) })));
    components = [new ActionRowBuilder().addComponents(select)];
  } else {
    const btn = new ButtonBuilder()
      .setCustomId(`resp:answer:${session.survey.id}`)
      .setLabel('✍️ Répondre')
      .setStyle(ButtonStyle.Primary);
    components = [new ActionRowBuilder().addComponents(btn)];
  }

  if (!q.required) {
    components[0].addComponents(
      new ButtonBuilder().setCustomId(`resp:skip:${session.survey.id}`).setLabel('Passer').setStyle(ButtonStyle.Secondary)
    );
  }

  return { embeds: [embed], components };
}

function renderDone() {
  return {
    embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Merci !').setDescription('Tes réponses ont bien été enregistrées.')],
    components: []
  };
}

// Détermine et rend l'étape courante d'une session (choix anonymat / question / fin)
function renderCurrentStep(session) {
  if (session.survey.anonymity_mode === 'choix' && session.anonymous === null) {
    return renderAnonymityStep(session);
  }
  if (session.index >= session.questions.length) {
    return renderDone();
  }
  return renderQuestion(session);
}

/* ------------------------------------------------------------------ */
/*  Démarrage du flux (commande /enquete ou bouton "Répondre")          */
/* ------------------------------------------------------------------ */

async function startResponseFlow(interaction, survey) {
  const questions = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position ASC').all(survey.id);
  if (!questions.length) {
    return interaction.reply({ content: "❌ Cette enquête n'a pas encore de questions.", ephemeral: true });
  }

  const userId = interaction.user.id;
  let session = loadSession(survey.id, userId);

  if (!session) {
    let anonymous = null;
    if (survey.anonymity_mode === 'oui') anonymous = true;
    else if (survey.anonymity_mode === 'non') anonymous = false;
    // sinon ('choix') : reste null jusqu'à ce que l'utilisateur choisisse

    session = { survey, questions, userId, index: 0, answers: [], anonymous };
    saveSession(session);
  } else {
    // reprise d'une session existante (ex: après un redémarrage du bot)
    session.survey = survey;
    session.questions = questions;
  }

  const rendered = renderCurrentStep(session);
  await interaction.reply({ ...rendered, ephemeral: true });
}

/* ------------------------------------------------------------------ */
/*  Étape : choix de l'anonymat (mode "choix")                          */
/* ------------------------------------------------------------------ */

async function handleAnonymityChoice(interaction, surveyId, value) {
  const session = loadSession(surveyId, interaction.user.id);
  if (!session) return interaction.reply({ content: '❌ Session expirée, relance `/enquete`.', ephemeral: true });

  session.anonymous = value === 'oui';
  saveSession(session);

  const rendered = renderCurrentStep(session);
  await interaction.update(rendered);
}

/* ------------------------------------------------------------------ */
/*  Réponse à une question (modal texte/nombre)                         */
/* ------------------------------------------------------------------ */

async function showAnswerModal(interaction, surveyId) {
  const session = loadSession(surveyId, interaction.user.id);
  if (!session) return interaction.reply({ content: '❌ Session expirée, relance `/enquete`.', ephemeral: true });
  const q = session.questions[session.index];

  const modal = new ModalBuilder().setCustomId(`resp:modal:${surveyId}`).setTitle(q.label.slice(0, 45) || 'Réponse');
  const input = new TextInputBuilder()
    .setCustomId('answer')
    .setLabel(q.type === 'nombre' ? 'Entre un nombre' : 'Ta réponse')
    .setStyle(q.type === 'nombre' ? TextInputStyle.Short : TextInputStyle.Paragraph)
    .setRequired(!!q.required)
    .setMaxLength(q.type === 'nombre' ? 20 : 1000);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

function finalizeIfDone(session) {
  if (session.index < session.questions.length) return false;

  const info = db
    .prepare('INSERT INTO responses (survey_id, user_id, is_anonymous, created_at) VALUES (?, ?, ?, ?)')
    .run(session.survey.id, session.anonymous ? 'anonymous' : session.userId, session.anonymous ? 1 : 0, Date.now());

  const insertAnswer = db.prepare('INSERT INTO answers (response_id, question_id, value) VALUES (?, ?, ?)');
  for (const a of session.answers) {
    insertAnswer.run(info.lastInsertRowid, a.questionId, a.value);
  }
  clearSession(session.survey.id, session.userId);
  return true;
}

async function handleSelectAnswer(interaction, surveyId) {
  const session = loadSession(surveyId, interaction.user.id);
  if (!session) return interaction.reply({ content: '❌ Session expirée, relance `/enquete`.', ephemeral: true });

  const q = session.questions[session.index];
  session.answers.push({ questionId: q.id, value: interaction.values[0] });
  session.index++;

  const done = finalizeIfDone(session);
  if (!done) saveSession(session);

  await interaction.update(renderCurrentStep(session));
}

async function handleSkip(interaction, surveyId) {
  const session = loadSession(surveyId, interaction.user.id);
  if (!session) return interaction.reply({ content: '❌ Session expirée, relance `/enquete`.', ephemeral: true });

  session.index++;

  const done = finalizeIfDone(session);
  if (!done) saveSession(session);

  await interaction.update(renderCurrentStep(session));
}

async function handleModalAnswer(interaction, surveyId) {
  const session = loadSession(surveyId, interaction.user.id);
  if (!session) return interaction.reply({ content: '❌ Session expirée, relance `/enquete`.', ephemeral: true });

  const q = session.questions[session.index];
  const value = interaction.fields.getTextInputValue('answer').trim();

  if (q.type === 'nombre' && value !== '' && Number.isNaN(Number(value))) {
    return interaction.reply({ content: '❌ Merci d\'entrer un nombre valide. Recommence en cliquant sur "Répondre".', ephemeral: true });
  }

  session.answers.push({ questionId: q.id, value });
  session.index++;

  const done = finalizeIfDone(session);
  if (!done) saveSession(session);

  const payload = renderCurrentStep(session);

  // Le modal a été ouvert depuis un composant du message éphémère : on peut l'éditer via update().
  if (interaction.isFromMessage && interaction.isFromMessage()) {
    await interaction.update(payload);
  } else {
    await interaction.reply({ ...payload, ephemeral: true });
  }
}

module.exports = {
  startResponseFlow,
  alreadyMaxedOut,
  showAnswerModal,
  handleSelectAnswer,
  handleSkip,
  handleModalAnswer,
  handleAnonymityChoice
};
