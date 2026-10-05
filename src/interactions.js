const { MessageFlags } = require('discord.js');
const perms = require('./permissions');
const panels = require('./panels');
const flow = require('./responseFlow');

// Détermine la permission nécessaire pour un customId donné.
// Les interactions publiques (réponses aux enquêtes, suppression de MP) ne nécessitent rien.
function checkPermissionForCustomId(interaction, customId) {
  if (customId.startsWith('resp:') || customId === 'dm:delete' || customId === 'preview:noop') return true;

  // Mode utilisateur (self-service) : accessible à tout membre. L'autorisation
  // fine (blocage, option par enquête) est vérifiée dans les handlers eux-mêmes.
  if (customId.startsWith('mode:')) return true;

  if (customId.startsWith('survey:')) return perms.hasPerm(interaction, perms.PERMS.MANAGE_SURVEYS);

  if (customId === 'cfg:back') return perms.hasAnyPerm(interaction);
  if (customId.startsWith('cfg:perm')) return perms.canManagePermissions(interaction);
  if (customId.startsWith('cfg:logs')) return perms.hasPerm(interaction, perms.PERMS.VIEW_LOGS);
  if (customId.startsWith('cfg:data')) return perms.hasPerm(interaction, perms.PERMS.MANAGE_DATA);
  if (customId === 'cfg:welcome' || customId.startsWith('cfg:dmjoin')) return perms.hasPerm(interaction, perms.PERMS.MANAGE_MP_WELCOME);
  if (customId.startsWith('cfg:broadcast')) return perms.hasPerm(interaction, perms.PERMS.MP_ALL) || perms.hasPerm(interaction, perms.PERMS.MANAGE_MP);
  if (customId.startsWith('cfg:preset:')) {
    const ctx = customId.split(':')[2];
    if (ctx === 'broadcast') return perms.hasPerm(interaction, perms.PERMS.MP_ALL) || perms.hasPerm(interaction, perms.PERMS.MANAGE_MP);
    if (ctx === 'dmjoin') return perms.hasPerm(interaction, perms.PERMS.MANAGE_MP_WELCOME);
    return false;
  }
  if (
    customId.startsWith('cfg:surveys') ||
    customId === 'cfg:channels' ||
    customId.startsWith('cfg:new_survey') ||
    customId.startsWith('cfg:survey:') ||
    customId.startsWith('cfg:logchannel') ||
    customId === 'cfg:stats' ||
    customId === 'cfg:stats:filter' ||
    customId === 'cfg:channel:select' ||
    customId === 'cfg:channel:clear'
  ) {
    return perms.hasPerm(interaction, perms.PERMS.MANAGE_SURVEYS);
  }

  // Par prudence, tout customId non reconnu exige au moins une permission.
  return perms.hasAnyPerm(interaction);
}

async function handle(interaction) {
  const customId = interaction.customId;
  if (!customId) return;

  if (!checkPermissionForCustomId(interaction, customId)) {
    if (interaction.isRepliable()) {
      await interaction.reply({ content: "❌ Tu n'as pas la permission de faire ça.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return;
  }

  /* ------------------------- BOUTONS ------------------------- */
  if (interaction.isButton()) {
    if (customId === 'preview:noop') return interaction.deferUpdate().catch(() => {});

    if (customId === 'cfg:back') {
      const { embed, components } = panels.buildMainPanel(interaction);
      return interaction.update({ content: null, embeds: [embed], components });
    }
    if (customId === 'cfg:surveys') return panels.showSurveyManagementPanel(interaction);
    if (customId === 'cfg:surveys:archived') return panels.showSurveyManagementPanel(interaction, 0, 'archived');
    if (customId === 'cfg:surveys:templates') return panels.showSurveyManagementPanel(interaction, 0, 'templates');
    if (customId === 'cfg:channels') return panels.showChannelsPanel(interaction);
    if (customId === 'cfg:logchannel:clear') return panels.clearResponsesLogChannel(interaction);
    if (customId === 'cfg:channel:clear') return panels.clearResponseChannel(interaction);
    if (customId === 'cfg:welcome') return panels.showWelcomeMpPanel(interaction);
    if (customId === 'cfg:dmjoin:toggle') return panels.toggleDmOnJoin(interaction);
    if (customId === 'cfg:dmjoin:message') return panels.showPresetPanel(interaction, 'dmjoin');
    if (customId === 'cfg:broadcast') return panels.showBroadcastTargetPanel(interaction);
    if (customId === 'cfg:broadcast:all') return panels.selectBroadcastAll(interaction);
    if (customId === 'cfg:broadcast:confirm') return panels.confirmBroadcast(interaction);
    if (customId === 'cfg:broadcast:cancel') return panels.cancelBroadcast(interaction);
    if (customId === 'cfg:new_survey') return panels.showTemplateChoicePanel(interaction);
    if (customId === 'cfg:data') return panels.showDataPanel(interaction);
    if (customId === 'cfg:perm') return panels.showPermissionsPanel(interaction);
    if (customId === 'cfg:stats') return panels.showGlobalStats(interaction, 'all');

    if (customId.startsWith('cfg:new_survey:tmpl:')) {
      const templateId = customId.split(':')[3];
      return panels.showNewSurveyModalForTemplate(interaction, templateId);
    }
    if (customId.startsWith('cfg:survey:list:')) {
      const parts = customId.split(':');
      const page = parseInt(parts[3], 10) || 0;
      const mode = parts[4] === '1' ? 'archived' : parts[4] === '2' ? 'templates' : 'active';
      return panels.showSurveyManagementPanel(interaction, page, mode);
    }
    if (customId.startsWith('cfg:logs:')) {
      const page = parseInt(customId.split(':')[2], 10) || 0;
      return panels.showLogsPanel(interaction, page);
    }
    if (customId.startsWith('cfg:data:user:confirm:')) {
      const userId = customId.split(':').pop();
      return panels.executeDataUserDeletion(interaction, userId);
    }
    if (customId.startsWith('cfg:data:user:view:')) {
      const userId = customId.split(':').pop();
      return panels.exportUserResponsesHtml(interaction, userId);
    }
    if (customId.startsWith('cfg:data:user:delete:')) {
      const userId = customId.split(':').pop();
      return panels.confirmDeleteUserData(interaction, userId);
    }
    if (customId.startsWith('cfg:data:user:block:')) {
      const userId = customId.split(':').pop();
      return panels.toggleUserBlock(interaction, userId);
    }
    if (customId.startsWith('cfg:data:survey:confirm:')) {
      const surveyId = customId.split(':').pop();
      return panels.executeDataSurveyClear(interaction, surveyId);
    }
    if (customId.startsWith('cfg:data:survey:view:')) {
      const surveyId = customId.split(':').pop();
      return panels.exportSurveyHtml(interaction, surveyId);
    }
    if (customId.startsWith('cfg:data:survey:delete:')) {
      const surveyId = customId.split(':').pop();
      return panels.confirmClearSurveyData(interaction, surveyId);
    }
    if (customId.startsWith('cfg:perm:toggle:')) {
      const [, , , userId, perm] = customId.split(':');
      return panels.togglePermission(interaction, userId, perm);
    }
    if (customId.startsWith('cfg:perm:mprestrict:clear:')) {
      const userId = customId.split(':').pop();
      return panels.clearMpRestrictionsHandler(interaction, userId);
    }
    if (customId.startsWith('cfg:perm:mprestrict:')) {
      const userId = customId.split(':')[3];
      return panels.showMpRestrictionsPanel(interaction, userId);
    }
    if (customId.startsWith('cfg:perm:select:back:')) {
      const userId = customId.split(':').pop();
      return panels.backToUserPermissions(interaction, userId);
    }

    // Anonymat (édition — ouvre le <select> multi-choix)
    if (customId.startsWith('survey:anonedit:')) {
      const surveyId = customId.split(':')[2];
      return panels.showAnonymityChooserButton(interaction, surveyId);
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
    if (customId.startsWith('survey:qformat:')) {
      const [, , surveyId, value] = customId.split(':');
      return panels.handleFormatChoice(interaction, surveyId, value);
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
    if (customId.startsWith('survey:qmanage:')) {
      const [, , surveyId, questionId] = customId.split(':');
      return panels.showQuestionManagePanel(interaction, surveyId, questionId);
    }
    if (customId.startsWith('survey:condq:clear:')) {
      const [, , , surveyId, questionId] = customId.split(':');
      return panels.clearCondition(interaction, surveyId, questionId);
    }
    if (customId.startsWith('survey:condq:')) {
      const [, , surveyId, questionId] = customId.split(':');
      return panels.showConditionPicker(interaction, surveyId, questionId);
    }
    if (customId.startsWith('survey:moveq:')) {
      const [, , surveyId, questionId, direction] = customId.split(':');
      return panels.moveQuestion(interaction, surveyId, questionId, direction);
    }
    if (customId.startsWith('survey:builder:')) {
      const surveyId = customId.split(':')[2];
      return panels.backToBuilder(interaction, surveyId);
    }
    if (customId.startsWith('survey:addq:')) {
      const surveyId = customId.split(':')[2];
      return panels.startAddQuestion(interaction, surveyId);
    }
    if (customId.startsWith('survey:editmeta:')) {
      const surveyId = customId.split(':')[2];
      return panels.showEditMetaModal(interaction, surveyId);
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
    if (customId.startsWith('survey:advanced:')) {
      const surveyId = customId.split(':')[2];
      return panels.showDashboardAdvanced(interaction, surveyId);
    }
    if (customId.startsWith('survey:exportcsv:')) {
      const surveyId = customId.split(':')[2];
      return panels.exportSurveyCsv(interaction, surveyId);
    }
    if (customId.startsWith('survey:exportbackup:')) {
      const surveyId = customId.split(':')[2];
      return panels.exportSurveyBackup(interaction, surveyId);
    }
    if (customId.startsWith('survey:rewardrole:clear:')) {
      const surveyId = customId.split(':')[3];
      return panels.clearRewardRole(interaction, surveyId);
    }
    if (customId.startsWith('survey:reminder:') && !customId.startsWith('survey:reminder:modal:')) {
      const surveyId = customId.split(':')[2];
      return panels.showReminderModal(interaction, surveyId);
    }
    if (customId.startsWith('survey:raffle:')) {
      const surveyId = customId.split(':')[2];
      return panels.drawRaffleWinner(interaction, surveyId);
    }
    if (customId.startsWith('survey:template:toggle:')) {
      const surveyId = customId.split(':')[3];
      return panels.toggleTemplate(interaction, surveyId);
    }
    if (customId.startsWith('survey:archive:')) {
      const surveyId = customId.split(':')[2];
      return panels.archiveSurvey(interaction, surveyId);
    }
    if (customId.startsWith('survey:unarchive:')) {
      const surveyId = customId.split(':')[2];
      return panels.unarchiveSurvey(interaction, surveyId);
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
    if (customId.startsWith('survey:exporthtml:')) {
      const surveyId = customId.split(':')[2];
      return panels.exportSurveyHtml(interaction, surveyId);
    }
    if (customId.startsWith('survey:charts:')) {
      const surveyId = customId.split(':')[2];
      return panels.showResultsCharts(interaction, surveyId);
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
      if (!survey) return interaction.reply({ content: "❌ Cette enquête n'est plus active.", flags: MessageFlags.Ephemeral });
      if (flow.alreadyMaxedOut(survey, interaction.user.id)) {
        return interaction.reply({ content: '❌ Tu as déjà répondu au maximum autorisé pour cette enquête.', flags: MessageFlags.Ephemeral });
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
    if (customId.startsWith('resp:prev:')) {
      const surveyId = customId.split(':')[2];
      return flow.handlePrevious(interaction, surveyId);
    }
    if (customId.startsWith('resp:confirm:')) {
      const surveyId = customId.split(':')[2];
      return flow.handleConfirm(interaction, surveyId);
    }
    if (customId.startsWith('resp:cancel:')) {
      const surveyId = customId.split(':')[2];
      return flow.handleCancel(interaction, surveyId);
    }
    if (customId.startsWith('resp:priv:')) {
      const [, , surveyId, value] = customId.split(':');
      return flow.handleAnonymityChoice(interaction, surveyId, value);
    }
    if (customId === 'dm:delete') {
      return panels.handleDmDelete(interaction);
    }

    // Mode utilisateur (self-service sur ses propres réponses)
    if (customId === 'mode:user') {
      const { embed, components } = panels.buildUserModePanel(interaction);
      return interaction.update({ content: null, embeds: [embed], components });
    }
    if (customId === 'mode:admin') {
      if (!perms.hasAnyPerm(interaction)) {
        return interaction.reply({ content: "❌ Tu n'as pas accès au mode gestion.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      const { embed, components } = panels.buildMainPanel(interaction);
      return interaction.update({ content: null, embeds: [embed], components });
    }
    if (customId.startsWith('mode:user:survey:delete:')) {
      const surveyId = customId.split(':').pop();
      return panels.confirmDeleteOwnResponse(interaction, surveyId);
    }
    if (customId.startsWith('mode:user:survey:confirm:')) {
      const surveyId = customId.split(':').pop();
      return panels.executeDeleteOwnResponse(interaction, surveyId);
    }
    if (customId.startsWith('mode:user:survey:cancel:')) {
      const surveyId = customId.split(':').pop();
      return panels.showUserSurveyPanel(interaction, surveyId);
    }
    if (customId.startsWith('survey:selfdelete:toggle:')) {
      const surveyId = customId.split(':').pop();
      return panels.toggleSelfDelete(interaction, surveyId);
    }
    if (customId.startsWith('survey:selfedit:toggle:')) {
      const surveyId = customId.split(':').pop();
      return panels.toggleSelfEdit(interaction, surveyId);
    }
    if (customId.startsWith('mode:user:survey:view:')) {
      const surveyId = customId.split(':').pop();
      return panels.viewOwnResponse(interaction, surveyId);
    }
    if (customId.startsWith('mode:user:survey:edit:')) {
      const surveyId = customId.split(':').pop();
      return panels.startEditOwnResponse(interaction, surveyId);
    }
    return;
  }

  /* ---------------------- SELECT MENUS ------------------------ */
  if (interaction.isChannelSelectMenu()) {
    if (customId === 'cfg:channel:select') return panels.setChannel(interaction);
    if (customId === 'cfg:logchannel:select') return panels.setResponsesLogChannel(interaction);
  }
  if (interaction.isRoleSelectMenu()) {
    if (customId.startsWith('survey:rewardrole:')) {
      const surveyId = customId.split(':')[2];
      return panels.setRewardRole(interaction, surveyId);
    }
    if (customId === 'cfg:broadcast:role') return panels.selectBroadcastRole(interaction);
    if (customId.startsWith('cfg:perm:mprestrict:addrole:')) {
      const userId = customId.split(':')[4];
      return panels.addMpRestrictionRole(interaction, userId);
    }
  }
  if (interaction.isUserSelectMenu()) {
    if (customId === 'cfg:broadcast:users') return panels.selectBroadcastUsers(interaction);
    if (customId === 'cfg:data:user') return panels.selectDataUser(interaction);
    if (customId === 'cfg:perm:select') return panels.selectPermissionUser(interaction);
    if (customId === 'cfg:logs:filter:actor') return panels.filterLogsByActor(interaction);
    if (customId.startsWith('cfg:perm:mprestrict:adduser:')) {
      const userId = customId.split(':')[4];
      return panels.addMpRestrictionUser(interaction, userId);
    }
  }
  if (interaction.isStringSelectMenu()) {
    if (customId === 'cfg:survey:select') return panels.openSurveyFromSelect(interaction);
    if (customId === 'cfg:data:survey') return panels.selectDataSurvey(interaction);
    if (customId === 'cfg:stats:filter') return panels.handleStatsFilter(interaction);
    if (customId === 'cfg:logs:filter:action') return panels.filterLogsByAction(interaction);
    if (customId.startsWith('cfg:preset:')) {
      const context = customId.split(':')[2];
      return panels.handlePresetSelect(interaction, context);
    }
    if (customId === 'cfg:broadcast:highlight') return panels.handleHighlightSelect(interaction);
    if (customId === 'mode:user:survey') return panels.selectUserSurvey(interaction);
    if (customId.startsWith('survey:anonmode:')) {
      const surveyId = customId.split(':')[2];
      return panels.handleAnonymityModeChoice(interaction, surveyId);
    }
    if (customId.startsWith('survey:condq:pick:')) {
      const [, , , surveyId, questionId] = customId.split(':');
      return panels.pickConditionSourceQuestion(interaction, surveyId, questionId);
    }
    if (customId.startsWith('survey:condq:value:')) {
      const [, , , surveyId, questionId, sourceId] = customId.split(':');
      return panels.setConditionValue(interaction, surveyId, questionId, sourceId);
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
      if (!survey) return interaction.reply({ content: "❌ Cette enquête n'est plus active.", flags: MessageFlags.Ephemeral });
      if (flow.alreadyMaxedOut(survey, interaction.user.id)) {
        return interaction.reply({ content: '❌ Tu as déjà répondu au maximum autorisé pour cette enquête.', flags: MessageFlags.Ephemeral });
      }
      return flow.startResponseFlow(interaction, survey);
    }
  }

  /* ------------------------- MODALS ---------------------------- */
  if (interaction.isModalSubmit()) {
    if (customId.startsWith('survey:reminder:modal:')) {
      const surveyId = customId.split(':')[3];
      return panels.saveReminder(interaction, surveyId);
    }
    if (customId === 'cfg:dmjoin:modal') return panels.saveDmJoinMessage(interaction);
    if (customId === 'cfg:broadcast:modal') return panels.prepareBroadcast(interaction);
    if (customId.startsWith('cfg:new_survey:modal:')) {
      const templateId = customId.split(':')[3];
      return panels.createSurvey(interaction, templateId);
    }
    if (customId.startsWith('survey:editmeta:modal:')) {
      const surveyId = customId.split(':')[3];
      return panels.saveEditMeta(interaction, surveyId);
    }
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
