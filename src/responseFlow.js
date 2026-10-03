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
const messages = require('./messages');
const logs = require('./logs');
const logger = require('./logger');

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
    answers: JSON.parse(row.answers), // tableau aligné sur l'ordre des questions (valeur ou null)
    anonymous: row.anonymous === null || row.anonymous === undefined ? null : !!row.anonymous,
    isPublic: row.is_public === null || row.is_public === undefined ? null : !!row.is_public,
    preview: !!row.preview,
    editMode: !!row.edit_mode
  };
}

function saveSession(session) {
  db.prepare(
    `INSERT INTO response_sessions (survey_id, user_id, current_index, answers, anonymous, is_public, preview, edit_mode, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(survey_id, user_id) DO UPDATE SET
       current_index = excluded.current_index,
       answers = excluded.answers,
       anonymous = excluded.anonymous,
       is_public = excluded.is_public,
       preview = excluded.preview,
       edit_mode = excluded.edit_mode,
       updated_at = excluded.updated_at`
  ).run(
    session.survey.id,
    session.userId,
    session.index,
    JSON.stringify(session.answers),
    session.anonymous === null ? null : session.anonymous ? 1 : 0,
    session.isPublic === null || session.isPublic === undefined ? null : session.isPublic ? 1 : 0,
    session.preview ? 1 : 0,
    session.editMode ? 1 : 0,
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
  const count = db.prepare("SELECT COUNT(*) c FROM responses WHERE survey_id = ? AND user_id = ? AND is_anonymous = 0").get(survey.id, userId).c;
  return count >= survey.max_responses_per_user;
}

/* ------------------------------------------------------------------ */
/*  Rendu des étapes                                                    */
/* ------------------------------------------------------------------ */

function previewBanner(session) {
  return session.preview ? '🔍 **Mode aperçu — tes réponses ne seront pas enregistrées.**\n\n' : '';
}

function renderClosedNotice() {
  return {
    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('🔒 Enquête fermée').setDescription("Cette enquête a été clôturée entre-temps. Tes réponses n'ont pas été enregistrées.")],
    components: []
  };
}

// Mode "choice" : le membre choisit entre Publique (nom visible dans les stats)
// et Semi-privé (nom visible du staff uniquement). Le mode Privé n'a pas cette
// étape : il est toujours entièrement anonyme, défini directement à la création.
function renderPrivacyChoiceStep(session) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📝 ${session.survey.name}`)
    .setDescription(
      `${previewBanner(session)}Comment veux-tu répondre ?\n\n` +
        '🌐 **Publique** — ton nom sera visible dans les statistiques\n' +
        '🛡️ **Semi-privé** — ton nom ne sera visible que du staff'
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`resp:priv:${session.survey.id}:public`).setLabel('Publique').setStyle(ButtonStyle.Primary).setEmoji('🌐'),
    new ButtonBuilder().setCustomId(`resp:priv:${session.survey.id}:semi`).setLabel('Semi-privé').setStyle(ButtonStyle.Secondary).setEmoji('🛡️')
  );

  return { embeds: [embed], components: [row] };
}

function renderQuestion(session) {
  const q = session.questions[session.index];
  const progress = `Question ${session.index + 1} / ${session.questions.length}`;
  const existing = session.answers[session.index];

  let hint = '';
  if (q.type === 'nombre' && (q.min_value !== null || q.max_value !== null)) {
    const min = q.min_value !== null && q.min_value !== undefined ? q.min_value : '−∞';
    const max = q.max_value !== null && q.max_value !== undefined ? q.max_value : '+∞';
    hint = ` *(entre ${min} et ${max})*`;
  } else if (q.type === 'choix' && q.min_select !== q.max_select) {
    hint = ` *(choisis entre ${q.min_select} et ${q.max_select} options)*`;
  } else if (q.type === 'choix' && q.max_select > 1) {
    hint = ` *(choisis ${q.max_select} options)*`;
  }

  const privacyTag = session.anonymous ? 'réponse privée (anonyme)' : session.isPublic ? 'réponse publique' : session.isPublic === false ? 'réponse semi-privée' : null;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📝 ${session.survey.name}`)
    .setDescription(`${previewBanner(session)}**${q.label}**${q.required ? '' : ' *(optionnel)*'}${hint}${existing ? `\n\n*Réponse actuelle : ${String(existing).slice(0, 200)}*` : ''}`)
    .setFooter({ text: (session.preview ? 'Aperçu • ' : '') + progress + (privacyTag ? ` • ${privacyTag}` : '') });

  // Ligne principale : répondre (bouton ou menu de choix)
  let mainRow;
  const mainControls = new ActionRowBuilder();

  if (q.type === 'choix') {
    const options = JSON.parse(q.options || '[]');
    const existingValues = existing ? String(existing).split(', ') : [];
    const minValues = Math.max(1, Math.min(q.min_select || 1, options.length));
    const maxValues = Math.max(minValues, Math.min(q.max_select || 1, options.length));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`resp:select:${session.survey.id}`)
      .setPlaceholder(maxValues > 1 ? `Choisis ${minValues === maxValues ? minValues : `${minValues} à ${maxValues}`} option(s)` : 'Choisis une réponse')
      .setMinValues(minValues)
      .setMaxValues(maxValues)
      .addOptions(options.slice(0, 25).map(o => ({ label: o.slice(0, 100), value: o.slice(0, 100), default: existingValues.includes(o) })));
    mainRow = new ActionRowBuilder().addComponents(select);
  } else {
    mainControls.addComponents(
      new ButtonBuilder()
        .setCustomId(`resp:answer:${session.survey.id}`)
        .setLabel(existing ? '✍️ Modifier ma réponse' : '✍️ Répondre')
        .setStyle(ButtonStyle.Primary)
    );
  }
  if (!q.required) {
    mainControls.addComponents(new ButtonBuilder().setCustomId(`resp:skip:${session.survey.id}`).setLabel('Passer').setStyle(ButtonStyle.Secondary));
  }

  // Deuxième ligne : navigation (Précédent / Annuler), séparée de la ligne de réponse
  const navRow = new ActionRowBuilder();
  if (session.index > 0) {
    navRow.addComponents(new ButtonBuilder().setCustomId(`resp:prev:${session.survey.id}`).setLabel('◀️ Précédent').setStyle(ButtonStyle.Secondary));
  }
  navRow.addComponents(new ButtonBuilder().setCustomId(`resp:cancel:${session.survey.id}`).setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary));

  const components = [];
  if (mainRow) components.push(mainRow);
  if (mainControls.components.length) components.push(mainControls);
  components.push(navRow);

  return { embeds: [embed], components };
}

function renderRecap(session) {
  const lines = session.questions.map((q, i) => {
    const val = session.answers[i];
    const displayed = val === null || val === undefined || val === '' ? '*(pas de réponse)*' : String(val).slice(0, 200);
    return `**${i + 1}. ${q.label}**\n${displayed}`;
  });

  const privacyTag = session.anonymous ? '🙈 Envoi privé (anonyme)' : session.isPublic ? '🌐 Envoi public' : session.isPublic === false ? '🛡️ Envoi semi-privé' : 'Vérifie tes réponses avant envoi';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📝 ${session.survey.name} — Récapitulatif`)
    .setDescription(previewBanner(session) + lines.join('\n\n').slice(0, 4000))
    .setFooter({ text: (session.preview ? 'Aperçu • ' : '') + privacyTag });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`resp:confirm:${session.survey.id}`)
      .setLabel(session.preview ? "✅ Terminer l'aperçu" : session.editMode ? '💾 Enregistrer les modifications' : '✅ Envoyer mes réponses')
      .setStyle(ButtonStyle.Success)
  );
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`resp:prev:${session.survey.id}`).setLabel('◀️ Modifier une réponse').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`resp:cancel:${session.survey.id}`).setLabel('❌ Annuler').setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row, navRow] };
}

function renderDone(preview, editMode = false) {
  if (preview) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('🔍 Aperçu terminé')
          .setDescription("Voici comment se termine le parcours de réponse.\n\n**Tes réponses n'ont pas été enregistrées (mode aperçu).**")
      ],
      components: []
    };
  }
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('✅ Merci !')
        .setDescription(editMode ? 'Ta réponse a bien été mise à jour.' : 'Tes réponses ont bien été enregistrées.')
    ],
    components: []
  };
}

function renderCurrentStep(session) {
  if (!session.preview && session.survey.status !== 'active') return renderClosedNotice();
  if (session.survey.anonymity_mode === 'choice' && session.anonymous === null && session.isPublic === null) return renderPrivacyChoiceStep(session);
  if (session.index >= session.questions.length) return renderRecap(session);
  return renderQuestion(session);
}

/* ------------------------------------------------------------------ */
/*  Démarrage du flux (commande /enquete, bouton "Répondre" ou "Aperçu") */
/* ------------------------------------------------------------------ */

async function startResponseFlow(interaction, survey, preview = false, editMode = false) {
  const questions = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position ASC').all(survey.id);
  if (!questions.length) {
    return interaction.reply({ content: "❌ Cette enquête n'a pas encore de questions.", ephemeral: true });
  }

  const userId = interaction.user.id;
  let session = loadSession(survey.id, userId);

  if (!session) {
    let anonymous = null;
    let isPublic = null;
    let initialAnswers = new Array(questions.length).fill(null);

    if (editMode) {
      // On pré-remplit avec la réponse existante et on conserve son mode
      // d'envoi (public/semi-privé) : pas de nouveau choix à faire.
      const existingResponse = db
        .prepare('SELECT * FROM responses WHERE survey_id = ? AND user_id = ? AND is_anonymous = 0 ORDER BY created_at DESC LIMIT 1')
        .get(survey.id, userId);
      if (existingResponse) {
        anonymous = false;
        isPublic = !!existingResponse.is_public;
        const existingAnswers = db
          .prepare('SELECT a.value AS value, q.id AS qid FROM answers a JOIN questions q ON a.question_id = q.id WHERE a.response_id = ?')
          .all(existingResponse.id);
        const byQid = new Map(existingAnswers.map(a => [a.qid, a.value]));
        initialAnswers = questions.map(q => (byQid.has(q.id) ? byQid.get(q.id) : null));
      }
    }

    if (anonymous === null && isPublic === null) {
      if (survey.anonymity_mode === 'private') anonymous = true;
      else if (survey.anonymity_mode === 'public') {
        anonymous = false;
        isPublic = true;
      } else if (survey.anonymity_mode === 'semi') {
        anonymous = false;
        isPublic = false;
      }
      // mode 'choice' : anonymous/isPublic restent null jusqu'au choix du membre
      // (sauf en édition, où le choix d'origine a déjà été repris ci-dessus).
    }

    session = { survey, questions, userId, index: 0, answers: initialAnswers, anonymous, isPublic, preview, editMode: !!editMode };
    saveSession(session);
  } else {
    session.survey = survey;
    session.questions = questions;
    session.preview = preview;
    if (editMode) session.editMode = true;
    // Si le nombre de questions a changé depuis la dernière session (question ajoutée/supprimée),
    // on réaligne le tableau de réponses pour éviter tout décalage.
    if (session.answers.length !== questions.length) {
      const resized = new Array(questions.length).fill(null);
      for (let i = 0; i < Math.min(resized.length, session.answers.length); i++) resized[i] = session.answers[i];
      session.answers = resized;
      session.index = Math.min(session.index, questions.length);
    }
    saveSession(session);
  }

  const rendered = renderCurrentStep(session);
  const content = preview ? "🔍 **Ceci est un aperçu.** Tes réponses ne seront pas enregistrées." : editMode ? '✏️ **Modification de ta réponse** — les champs déjà remplis reprennent ta réponse actuelle.' : undefined;
  await interaction.reply({ content, ...rendered, ephemeral: true });
}

/* ------------------------------------------------------------------ */
/*  Étape : choix Publique / Semi-privé (mode "choice")                 */
/* ------------------------------------------------------------------ */

async function handleAnonymityChoice(interaction, surveyId, value) {
  const session = loadSession(surveyId, interaction.user.id);
  if (!session) return interaction.reply({ content: '❌ Session expirée, relance `/enquete`.', ephemeral: true });

  session.anonymous = false;
  session.isPublic = value === 'public';
  saveSession(session);

  await interaction.update(renderCurrentStep(session));
}

/* ------------------------------------------------------------------ */
/*  Navigation : précédent / annuler / confirmer                        */
/* ------------------------------------------------------------------ */

async function handlePrevious(interaction, surveyId) {
  const session = loadSession(surveyId, interaction.user.id);
  if (!session) return interaction.reply({ content: '❌ Session expirée, relance `/enquete`.', ephemeral: true });

  session.index = Math.max(0, session.index - 1);
  saveSession(session);
  await interaction.update(renderCurrentStep(session));
}

async function handleCancel(interaction, surveyId) {
  const session = loadSession(surveyId, interaction.user.id);
  clearSession(surveyId, interaction.user.id);
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x99aab5)
        .setTitle(session?.preview ? '❌ Aperçu annulé' : '❌ Réponse annulée')
        .setDescription(session?.preview ? "L'aperçu a été interrompu." : "Tes réponses n'ont pas été enregistrées. Tu peux relancer `/enquete` à tout moment.")
    ],
    components: []
  });
}

async function handleConfirm(interaction, surveyId) {
  const session = loadSession(surveyId, interaction.user.id);
  if (!session) return interaction.reply({ content: '❌ Session expirée, relance `/enquete`.', ephemeral: true });

  if (session.preview) {
    clearSession(surveyId, interaction.user.id);
    return interaction.update(renderDone(true));
  }

  if (session.survey.status !== 'active') {
    clearSession(surveyId, interaction.user.id);
    return interaction.update(renderClosedNotice());
  }

  // Modification d'une réponse existante : on retire l'ancienne avant
  // d'enregistrer la nouvelle, pour ne garder qu'une seule réponse à jour.
  let previousCount = 0;
  if (session.editMode) {
    const oldResponseIds = db
      .prepare('SELECT id FROM responses WHERE survey_id = ? AND user_id = ? AND is_anonymous = 0')
      .all(session.survey.id, session.userId)
      .map(r => r.id);
    previousCount = oldResponseIds.length;
    if (oldResponseIds.length) {
      db.prepare(`DELETE FROM answers WHERE response_id IN (${oldResponseIds.map(() => '?').join(',')})`).run(...oldResponseIds);
      db.prepare(`DELETE FROM responses WHERE id IN (${oldResponseIds.map(() => '?').join(',')})`).run(...oldResponseIds);
    }
  }

  const info = db
    .prepare('INSERT INTO responses (survey_id, user_id, is_anonymous, is_public, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(session.survey.id, session.anonymous ? 'anonymous' : session.userId, session.anonymous ? 1 : 0, session.anonymous ? null : session.isPublic ? 1 : 0, Date.now());

  const insertAnswer = db.prepare('INSERT INTO answers (response_id, question_id, value) VALUES (?, ?, ?)');
  session.questions.forEach((q, i) => {
    const val = session.answers[i];
    if (val !== null && val !== undefined && val !== '') insertAnswer.run(info.lastInsertRowid, q.id, val);
  });

  clearSession(surveyId, session.userId);
  await interaction.update(renderDone(false, session.editMode));

  if (session.editMode && previousCount) {
    try {
      logs.log(session.survey.guild_id, session.userId, 'data.selfedit', `<@${session.userId}> — « ${session.survey.name} »`);
    } catch (err) {
      logger.warn("Erreur lors de la journalisation d'une auto-modification:", err);
    }
  }

  // Effets de bord post-envoi : rafraîchir le message public et poster dans le
  // salon de réception configuré, si applicable. Ne doit jamais faire planter
  // la confirmation déjà envoyée à l'utilisateur, d'où le try/catch englobant.
  try {
    await messages.updatePublicMessageStats(interaction.client, session.survey);
    if (!session.editMode) await messages.logResponseToChannel(interaction.client, session.survey, session);
  } catch (err) {
    logger.warn("Erreur lors des effets de bord après l'envoi d'une réponse:", err);
  }
}

/* ------------------------------------------------------------------ */
/*  Réponse à une question (modal texte/nombre)                         */
/* ------------------------------------------------------------------ */

async function showAnswerModal(interaction, surveyId) {
  const session = loadSession(surveyId, interaction.user.id);
  if (!session) return interaction.reply({ content: '❌ Session expirée, relance `/enquete`.', ephemeral: true });
  if (!session.preview && session.survey.status !== 'active') return interaction.update(renderClosedNotice());

  const q = session.questions[session.index];
  const existing = session.answers[session.index];

  const isMultiline = q.type === 'texte' ? !!q.multiline : true;
  const modal = new ModalBuilder().setCustomId(`resp:modal:${surveyId}`).setTitle(q.label.slice(0, 45) || 'Réponse');
  const input = new TextInputBuilder()
    .setCustomId('answer')
    .setLabel(q.type === 'nombre' ? 'Entre un nombre' : 'Ta réponse')
    .setStyle(q.type === 'nombre' || !isMultiline ? TextInputStyle.Short : TextInputStyle.Paragraph)
    .setRequired(!!q.required)
    .setMaxLength(q.type === 'nombre' ? 20 : isMultiline ? 1000 : 150);
  if (existing) input.setValue(String(existing));

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleSelectAnswer(interaction, surveyId) {
  const session = loadSession(surveyId, interaction.user.id);
  if (!session) return interaction.reply({ content: '❌ Session expirée, relance `/enquete`.', ephemeral: true });
  if (!session.preview && session.survey.status !== 'active') return interaction.update(renderClosedNotice());

  session.answers[session.index] = interaction.values.join(', ');
  session.index++;
  saveSession(session);

  await interaction.update(renderCurrentStep(session));
}

async function handleSkip(interaction, surveyId) {
  const session = loadSession(surveyId, interaction.user.id);
  if (!session) return interaction.reply({ content: '❌ Session expirée, relance `/enquete`.', ephemeral: true });
  if (!session.preview && session.survey.status !== 'active') return interaction.update(renderClosedNotice());

  session.answers[session.index] = null;
  session.index++;
  saveSession(session);

  await interaction.update(renderCurrentStep(session));
}

async function handleModalAnswer(interaction, surveyId) {
  const session = loadSession(surveyId, interaction.user.id);
  if (!session) return interaction.reply({ content: '❌ Session expirée, relance `/enquete`.', ephemeral: true });

  const q = session.questions[session.index];
  const value = interaction.fields.getTextInputValue('answer').trim();

  if (q.type === 'nombre' && value !== '') {
    const num = Number(value);
    if (Number.isNaN(num)) {
      return interaction.reply({ content: '❌ Merci d\'entrer un nombre valide. Recommence en cliquant sur "Répondre".', ephemeral: true });
    }
    if (q.min_value !== null && q.min_value !== undefined && num < q.min_value) {
      return interaction.reply({ content: `❌ La valeur doit être supérieure ou égale à ${q.min_value}. Recommence en cliquant sur "Répondre".`, ephemeral: true });
    }
    if (q.max_value !== null && q.max_value !== undefined && num > q.max_value) {
      return interaction.reply({ content: `❌ La valeur doit être inférieure ou égale à ${q.max_value}. Recommence en cliquant sur "Répondre".`, ephemeral: true });
    }
  }

  session.answers[session.index] = value || null;
  session.index++;
  saveSession(session);

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
  handleAnonymityChoice,
  handlePrevious,
  handleCancel,
  handleConfirm
};
