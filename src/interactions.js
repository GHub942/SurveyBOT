const { isAuthorized } = require('./utils');
const panels = require('./panels');
const flow = require('./responseFlow');

// customId qui nécessitent d'être autorisé (config) — tout ce qui commence par "cfg:" ou "survey:"
function needsAuth(customId) {
  return customId.startsWith('cfg:') || customId.startsWith('survey:');
}

async function handle(interaction) {
  const customId = interaction.customId;
  if (!customId) return;

  if (needsAuth(customId) && !isAuthorized(interaction)) {
    const payload = { content: "❌ Tu n'as pas la permission de faire ça.", ephemeral: true };
    if (interaction.isRepliable()) await interaction.reply(payload).catch(() => {});
    return;
  }

  /* ------------------------- BOUTONS ------------------------- */
  if (interaction.isButton()) {
    if (customId === 'preview:noop') return interaction.deferUpdate().catch(() => {});

    if (customId === 'cfg:back') {
      const { embed, components } = panels.buildMainPanel(interaction.guildId);
      return interaction.update({ content: null, embeds: [embed], components });
    }
    if (customId === 'cfg:channel') return panels.showChannelSelect(interaction);
    if (customId === 'cfg:whitelist') return panels.showWhitelistPanel(interaction);
    if (customId === 'cfg:dmjoin:toggle') return panels.toggleDmOnJoin(interaction);
    if (customId === 'cfg:dmjoin:message') return panels.showPresetPanel(interaction, 'dmjoin');
    if (customId === 'cfg:broadcast') return panels.showBroadcastTargetPanel(interaction);
    if (customId === 'cfg:broadcast:all') return panels.selectBroadcastAll(interaction);
    if (customId === 'cfg:new_survey') return panels.showNewSurveyModal(interaction);
    if (customId === 'cfg:manage_surveys') return panels.showSurveyList(interaction, 0);
    if (customId === 'cfg:data') return panels.showDataPanel(interaction);

    if (customId.startsWith('cfg:survey:list:')) {
      const page = parseInt(customId.split(':')[3], 10) || 0;
      return panels.showSurveyList(interaction, page);
    }
    if (customId.startsWith('cfg:logs:')) {
      const page = parseInt(customId.split(':')[2], 10) || 0;
      return panels.showLogsPanel(interaction, page);
    }
    if (customId.startsWith('cfg:data:user:confirm:')) {
      const userId = customId.split(':')[3];
      return panels.executeDataUserDeletion(interaction, userId);
    }
    if (customId.startsWith('cfg:data:survey:confirm:')) {
      const surveyId = customId.split(':')[3];
      return panels.executeDataSurveyClear(interaction, surveyId);
    }

    // Anonymat choisi à la création d'enquête
    if (customId.startsWith('survey:anonmode:')) {
      const [, , surveyId, mode] = customId.split(':');
      return panels.handleAnonymityModeChoice(interaction, surveyId, mode);
    }

    // Construction d'enquête : gestion des questions
    if (customId.startsWith('survey:qtype:')) {
      const [, , surveyId, type] = customId.split(':');
      return panels.handleTypeChoice(interaction, surveyId, type);
    }
    if (customId.startsWith('survey:qreq:')) {
      const [, , surveyId, value] = customId.split(':');
      return panels.handleRequiredChoice(interaction, surveyId, value);
    }
    if (customId.startsWith('survey:editq:')) {
      const [, , surveyId, questionId] = customId.split(':');
      return panels.startEditQuestion(interaction, surveyId, questionId);
    }
    if (customId.startsWith('survey:delq2:confirm:')) {
      const [, , , surveyId, questionId] = customId.split(':');
      return panels.executeDeleteQuestion(interaction, surveyId, questionId);
    }
    if (customId.startsWith('survey:delq2:cancel:')) {
      const [, , , surveyId, questionId] = customId.split(':');
      return panels.showQuestionManagePanel(interaction, surveyId, questionId);
    }
    if (customId.startsWith('survey:delq2:')) {
      const [, , surveyId, questionId] = customId.split(':');
      return panels.confirmDeleteQuestion(interaction, surveyId, questionId);
    }
    if (customId.startsWith('survey:builder:')) {
      const surveyId = customId.split(':')[2];
      return panels.backToBuilder(interaction, surveyId);
    }
    if (customId.startsWith('survey:addq:')) {
      const surveyId = customId.split(':')[2];
      return panels.startAddQuestion(interaction, surveyId);
    }
    if (customId.startsWith('survey:preview:')) {
      const surveyId = customId.split(':')[2];
      return panels.previewSurvey(interaction, surveyId);
    }
    if (customId.startsWith('survey:closeat:')) {
      const surveyId = customId.split(':')[2];
      return panels.showCloseAtModal(interaction, surveyId);
    }
    if (customId.startsWith('survey:duplicate:')) {
      const surveyId = customId.split(':')[2];
      return panels.duplicateSurvey(interaction, surveyId);
    }
    if (customId.startsWith('survey:dash:page:')) {
      const [, , , surveyId, page] = customId.split(':');
      return panels.showDashboardPage(interaction, surveyId, parseInt(page, 10) || 0);
    }
    if (customId.startsWith('survey:publish:')) {
      const surveyId = customId.split(':')[2];
      return panels.publishSurvey(interaction, surveyId);
    }
    if (customId.startsWith('survey:cancel:')) {
      const surveyId = customId.split(':')[2];
      return panels.cancelSurvey(interaction, surveyId);
    }
    if (customId.startsWith('survey:activate:')) {
      const surveyId = customId.split(':')[2];
      return panels.setSurveyStatus(interaction, surveyId, 'active');
    }
    if (customId.startsWith('survey:deactivate:')) {
      const surveyId = customId.split(':')[2];
      return panels.setSurveyStatus(interaction, surveyId, 'closed');
    }
    if (customId.startsWith('survey:export:')) {
      const surveyId = customId.split(':')[2];
      return panels.exportSurvey(interaction, surveyId);
    }
    if (customId.startsWith('survey:delete:confirm:')) {
      const surveyId = customId.split(':')[3];
      return panels.deleteSurvey(interaction, surveyId);
    }
    if (customId.startsWith('survey:delete:cancel:')) {
      const surveyId = customId.split(':')[3];
      const { embed, components } = panels.buildDashboard(surveyId);
      return interaction.update({ embeds: [embed], components });
    }
    if (customId.startsWith('survey:delete:')) {
      const surveyId = customId.split(':')[2];
      return panels.confirmDeleteSurvey(interaction, surveyId);
    }

    // Réponses aux enquêtes
    if (customId.startsWith('resp:start:')) {
      const surveyId = customId.split(':')[2];
      const db = require('./database');
      const survey = db.prepare("SELECT * FROM surveys WHERE id = ? AND status = 'active'").get(surveyId);
      if (!survey) return interaction.reply({ content: "❌ Cette enquête n'est plus active.", ephemeral: true });
      if (flow.alreadyMaxedOut(survey, interaction.user.id)) {
        return interaction.reply({ content: '❌ Tu as déjà répondu au maximum autorisé pour cette enquête.', ephemeral: true });
      }
      return flow.startResponseFlow(interaction, survey);
    }
    if (customId.startsWith('resp:answer:')) {
      const surveyId = customId.split(':')[2];
      return flow.showAnswerModal(interaction, surveyId);
    }
    if (customId.startsWith('resp:skip:')) {
      const surveyId = customId.split(':')[2];
      return flow.handleSkip(interaction, surveyId);
    }
    if (customId.startsWith('resp:anon:')) {
      const [, , surveyId, value] = customId.split(':');
      return flow.handleAnonymityChoice(interaction, surveyId, value);
    }
    if (customId === 'dm:delete') {
      return panels.handleDmDelete(interaction);
    }
    return;
  }

  /* ---------------------- SELECT MENUS ------------------------ */
  if (interaction.isChannelSelectMenu()) {
    if (customId === 'cfg:channel:select') return panels.setChannel(interaction);
  }
  if (interaction.isRoleSelectMenu()) {
    if (customId === 'cfg:broadcast:role') return panels.selectBroadcastRole(interaction);
  }
  if (interaction.isUserSelectMenu()) {
    if (customId === 'cfg:whitelist:add') return panels.whitelistAdd(interaction);
    if (customId === 'cfg:whitelist:remove') return panels.whitelistRemove(interaction);
    if (customId === 'cfg:broadcast:users') return panels.selectBroadcastUsers(interaction);
    if (customId === 'cfg:data:user') return panels.selectDataUser(interaction);
  }
  if (interaction.isStringSelectMenu()) {
    if (customId === 'cfg:survey:select') return panels.openSurveyFromSelect(interaction);
    if (customId === 'cfg:data:survey') return panels.selectDataSurvey(interaction);
    if (customId.startsWith('cfg:preset:')) {
      const context = customId.split(':')[2];
      return panels.handlePresetSelect(interaction, context);
    }
    if (customId.startsWith('survey:manageq:')) {
      const surveyId = customId.split(':')[2];
      return panels.manageQuestionSelect(interaction, surveyId);
    }
    if (customId.startsWith('resp:select:')) {
      const surveyId = customId.split(':')[2];
      return flow.handleSelectAnswer(interaction, surveyId);
    }
    if (customId.startsWith('resp:dmselect:')) {
      const guildId = customId.split(':')[2];
      const db = require('./database');
      const surveyId = interaction.values[0];
      const survey = db
        .prepare("SELECT * FROM surveys WHERE id = ? AND guild_id = ? AND status = 'active'")
        .get(surveyId, guildId);
      if (!survey) return interaction.reply({ content: "❌ Cette enquête n'est plus active.", ephemeral: true });
      if (flow.alreadyMaxedOut(survey, interaction.user.id)) {
        return interaction.reply({ content: '❌ Tu as déjà répondu au maximum autorisé pour cette enquête.', ephemeral: true });
      }
      return flow.startResponseFlow(interaction, survey);
    }
  }

  /* ------------------------- MODALS ---------------------------- */
  if (interaction.isModalSubmit()) {
    if (customId === 'cfg:dmjoin:modal') return panels.saveDmJoinMessage(interaction);
    if (customId === 'cfg:broadcast:modal') return panels.runBroadcast(interaction);
    if (customId === 'cfg:new_survey:modal') return panels.createSurvey(interaction);
    if (customId.startsWith('survey:closeat:modal:')) {
      const surveyId = customId.split(':')[3];
      return panels.saveCloseAt(interaction, surveyId);
    }
    if (customId.startsWith('survey:editq:modal:')) {
      const surveyId = customId.split(':')[3];
      return panels.editQuestion(interaction, surveyId);
    }
    if (customId.startsWith('survey:addq:modal:')) {
      const surveyId = customId.split(':')[3];
      return panels.addQuestion(interaction, surveyId);
    }
    if (customId.startsWith('resp:modal:')) {
      const surveyId = customId.split(':')[2];
      return flow.handleModalAnswer(interaction, surveyId);
    }
  }
}

module.exports = { handle };
