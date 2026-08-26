const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder
} = require('discord.js');
const db = require('./database');
const logs = require('./logs');
const {
  isAuthorized,
  toCsvValue,
  broadcastTargets,
  questionDrafts,
  DM_PRESETS,
  ANONYMITY_LABELS,
  parseDateTimeFR,
  renderBar
} = require('./utils');

const SURVEYS_PER_PAGE = 25;
const DASHBOARD_QUESTIONS_PER_PAGE = 8;
const LOGS_PER_PAGE = 10;

/* ------------------------------------------------------------------ */
/*  PANNEAU PRINCIPAL                                                  */
/* ------------------------------------------------------------------ */

function buildMainPanel(guildId) {
  const cfg = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId) || {};
  const whitelistCount = db.prepare('SELECT COUNT(*) c FROM whitelist WHERE guild_id = ?').get(guildId).c;
  const surveyCount = db.prepare('SELECT COUNT(*) c FROM surveys WHERE guild_id = ?').get(guildId).c;

  const embed = new EmbedBuilder()
    .setTitle('⚙️ Panneau de configuration — Enquêtes')
    .setColor(0x5865f2)
    .addFields(
      { name: '📨 Salon des réponses', value: cfg.response_channel_id ? `<#${cfg.response_channel_id}>` : '*Non configuré*', inline: true },
      { name: '👥 Liste blanche', value: `${whitelistCount} utilisateur(s)`, inline: true },
      { name: '📋 Enquêtes créées', value: `${surveyCount}`, inline: true },
      { name: '👋 MP de bienvenue', value: cfg.dm_on_join ? '✅ Activé' : '❌ Désactivé', inline: true }
    )
    .setFooter({ text: 'Ce panneau est visible uniquement par toi.' });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfg:channel').setLabel('Salon des réponses').setStyle(ButtonStyle.Primary).setEmoji('📨'),
    new ButtonBuilder().setCustomId('cfg:whitelist').setLabel('Liste blanche').setStyle(ButtonStyle.Secondary).setEmoji('👥'),
    new ButtonBuilder().setCustomId('cfg:new_survey').setLabel('Nouvelle enquête').setStyle(ButtonStyle.Success).setEmoji('🆕'),
    new ButtonBuilder().setCustomId('cfg:manage_surveys').setLabel('Gérer les enquêtes').setStyle(ButtonStyle.Secondary).setEmoji('📋')
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('cfg:dmjoin:toggle')
      .setLabel(cfg.dm_on_join ? 'Désactiver MP de bienvenue' : 'Activer MP de bienvenue')
      .setStyle(cfg.dm_on_join ? ButtonStyle.Danger : ButtonStyle.Success)
      .setEmoji('👋'),
    new ButtonBuilder().setCustomId('cfg:dmjoin:message').setLabel('Message de bienvenue').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
    new ButtonBuilder().setCustomId('cfg:broadcast').setLabel('Envoyer un MP').setStyle(ButtonStyle.Danger).setEmoji('📢')
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfg:logs:0').setLabel('Journal').setStyle(ButtonStyle.Secondary).setEmoji('📜'),
    new ButtonBuilder().setCustomId('cfg:data').setLabel('Gérer les données').setStyle(ButtonStyle.Secondary).setEmoji('🗄️')
  );

  return { embed, components: [row1, row2, row3] };
}

/* ------------------------------------------------------------------ */
/*  SALON DES RÉPONSES                                                 */
/* ------------------------------------------------------------------ */

async function showChannelSelect(interaction) {
  const row = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('cfg:channel:select')
      .setPlaceholder('Choisis le salon où seront postées les enquêtes')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  );
  const back = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfg:back').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)
  );
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📨 Salon des réponses').setDescription('Sélectionne le salon où seront publiées les enquêtes et où les membres pourront répondre via le bouton.')],
    components: [row, back]
  });
}

async function setChannel(interaction) {
  const channelId = interaction.values[0];
  db.prepare(
    `INSERT INTO guild_config (guild_id, response_channel_id) VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET response_channel_id = excluded.response_channel_id`
  ).run(interaction.guildId, channelId);
  logs.logFromInteraction(interaction, 'config.channel', `<#${channelId}>`);

  const { embed, components } = buildMainPanel(interaction.guildId);
  await interaction.update({ content: `✅ Salon des réponses défini sur <#${channelId}>.`, embeds: [embed], components });
}

/* ------------------------------------------------------------------ */
/*  LISTE BLANCHE                                                      */
/* ------------------------------------------------------------------ */

async function showWhitelistPanel(interaction) {
  const rows = db.prepare('SELECT user_id FROM whitelist WHERE guild_id = ?').all(interaction.guildId);
  const list = rows.length ? rows.map(r => `<@${r.user_id}>`).join(', ') : '*Aucun utilisateur*';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('👥 Liste blanche')
    .setDescription("Les utilisateurs ci-dessous peuvent utiliser `/config` même sans la permission **Gérer le serveur**.\n\n" + list);

  const addRow = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId('cfg:whitelist:add').setPlaceholder('➕ Ajouter un utilisateur').setMaxValues(1)
  );
  const removeRow = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId('cfg:whitelist:remove').setPlaceholder('➖ Retirer un utilisateur').setMaxValues(1)
  );
  const back = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfg:back').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({ embeds: [embed], components: [addRow, removeRow, back] });
}

async function whitelistAdd(interaction) {
  const userId = interaction.values[0];
  db.prepare('INSERT OR IGNORE INTO whitelist (guild_id, user_id) VALUES (?, ?)').run(interaction.guildId, userId);
  logs.logFromInteraction(interaction, 'config.whitelist.add', `<@${userId}>`);
  await showWhitelistPanel(interaction);
}

async function whitelistRemove(interaction) {
  const userId = interaction.values[0];
  db.prepare('DELETE FROM whitelist WHERE guild_id = ? AND user_id = ?').run(interaction.guildId, userId);
  logs.logFromInteraction(interaction, 'config.whitelist.remove', `<@${userId}>`);
  await showWhitelistPanel(interaction);
}

/* ------------------------------------------------------------------ */
/*  MP DE BIENVENUE (dm on join)                                       */
/* ------------------------------------------------------------------ */

async function toggleDmOnJoin(interaction) {
  const cfg = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(interaction.guildId);
  const newVal = cfg && cfg.dm_on_join ? 0 : 1;
  db.prepare(
    `INSERT INTO guild_config (guild_id, dm_on_join) VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET dm_on_join = excluded.dm_on_join`
  ).run(interaction.guildId, newVal);
  logs.logFromInteraction(interaction, 'config.dmjoin.toggle', newVal ? 'activé' : 'désactivé');

  const { embed, components } = buildMainPanel(interaction.guildId);
  await interaction.update({ content: newVal ? '✅ MP de bienvenue activé.' : '❌ MP de bienvenue désactivé.', embeds: [embed], components });
}

async function saveDmJoinMessage(interaction) {
  const message = interaction.fields.getTextInputValue('message');
  db.prepare(
    `INSERT INTO guild_config (guild_id, dm_on_join_message) VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET dm_on_join_message = excluded.dm_on_join_message`
  ).run(interaction.guildId, message);
  logs.logFromInteraction(interaction, 'config.dmjoin.message');

  const { embed, components } = buildMainPanel(interaction.guildId);
  await interaction.reply({ content: '✅ Message de bienvenue enregistré.', embeds: [embed], components, ephemeral: true });
}

/* ------------------------------------------------------------------ */
/*  COMPOSANTS ATTACHÉS AUX MP (répondre à l'enquête / supprimer)      */
/* ------------------------------------------------------------------ */

function buildDmComponents(guild) {
  const activeSurveys = db
    .prepare("SELECT id, name FROM surveys WHERE guild_id = ? AND status = 'active'")
    .all(guild.id);

  const rows = [];

  if (activeSurveys.length === 1) {
    const s = activeSurveys[0];
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`resp:start:${s.id}`).setLabel(`Répondre : ${s.name}`.slice(0, 80)).setStyle(ButtonStyle.Success).setEmoji('📝')
      )
    );
  } else if (activeSurveys.length > 1) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`resp:dmselect:${guild.id}`)
      .setPlaceholder('📝 Choisis une enquête à laquelle répondre')
      .addOptions(activeSurveys.slice(0, 25).map(s => ({ label: s.name.slice(0, 100), value: String(s.id) })));
    rows.push(new ActionRowBuilder().addComponents(select));
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('dm:delete').setLabel('Supprimer ce message').setStyle(ButtonStyle.Secondary).setEmoji('🗑️')
    )
  );

  return rows;
}

async function handleDmDelete(interaction) {
  await interaction.deferUpdate().catch(() => {});
  await interaction.message.delete().catch(() => {});
}

/* ------------------------------------------------------------------ */
/*  MESSAGES PRÉ-REMPLIS (presets) POUR LES MP                         */
/* ------------------------------------------------------------------ */

async function showPresetPanel(interaction, context) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('✉️ Choisis un message')
    .setDescription('Sélectionne un modèle pré-rempli (tu pourras le modifier avant envoi) ou rédige le tien.');

  const select = new StringSelectMenuBuilder()
    .setCustomId(`cfg:preset:${context}`)
    .setPlaceholder('Choisis un modèle de message')
    .addOptions([
      ...DM_PRESETS.map(p => ({ label: p.label, description: p.text.slice(0, 95), value: p.id })),
      { label: '✍️ Message personnalisé', description: 'Rédiger un message depuis zéro', value: 'custom' }
    ]);

  const back = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfg:back').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select), back] });
}

async function handlePresetSelect(interaction, context) {
  const value = interaction.values[0];
  const preset = DM_PRESETS.find(p => p.id === value);
  const prefill = preset ? preset.text : '';

  if (context === 'broadcast') {
    const modal = new ModalBuilder().setCustomId('cfg:broadcast:modal').setTitle('Contenu du MP');
    const input = new TextInputBuilder()
      .setCustomId('message')
      .setLabel('Contenu du message privé')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1800)
      .setValue(prefill);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (context === 'dmjoin') {
    const cfg = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(interaction.guildId);
    const modal = new ModalBuilder().setCustomId('cfg:dmjoin:modal').setTitle('Message de bienvenue (MP)');
    const input = new TextInputBuilder()
      .setCustomId('message')
      .setLabel('Message envoyé en MP aux nouveaux membres')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1500)
      .setValue(prefill || cfg?.dm_on_join_message || '');
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }
}

/* ------------------------------------------------------------------ */
/*  MP CIBLÉ (broadcast : tous / par rôle / par utilisateurs)          */
/* ------------------------------------------------------------------ */

async function showBroadcastTargetPanel(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('📢 Envoyer un MP')
    .setDescription('Choisis les destinataires du message privé.');

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfg:broadcast:all').setLabel('Tous les membres').setStyle(ButtonStyle.Danger).setEmoji('🌐')
  );
  const row2 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId('cfg:broadcast:role').setPlaceholder('🎭 Cibler un rôle').setMaxValues(1)
  );
  const row3 = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId('cfg:broadcast:users').setPlaceholder('👤 Cibler des utilisateurs précis').setMaxValues(25)
  );
  const back = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfg:back').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({ embeds: [embed], components: [row1, row2, row3, back] });
}

async function selectBroadcastAll(interaction) {
  broadcastTargets.set(interaction.user.id, { type: 'all' });
  await showPresetPanel(interaction, 'broadcast');
}

async function selectBroadcastRole(interaction) {
  broadcastTargets.set(interaction.user.id, { type: 'role', roleId: interaction.values[0] });
  await showPresetPanel(interaction, 'broadcast');
}

async function selectBroadcastUsers(interaction) {
  broadcastTargets.set(interaction.user.id, { type: 'users', userIds: interaction.values });
  await showPresetPanel(interaction, 'broadcast');
}

// Envoi d'un MP avec gestion basique du rate-limit (retry avec backoff sur 429)
async function sendDmWithRetry(member, payload, attempt = 0) {
  try {
    await member.send(payload);
    return true;
  } catch (err) {
    const isRateLimit = err?.status === 429 || err?.code === 429;
    if (isRateLimit && attempt < 3) {
      const wait = (err?.retryAfter ? err.retryAfter * 1000 : 1000) * (attempt + 1);
      await new Promise(r => setTimeout(r, wait));
      return sendDmWithRetry(member, payload, attempt + 1);
    }
    return false;
  }
}

async function runBroadcast(interaction) {
  const message = interaction.fields.getTextInputValue('message');
  const target = broadcastTargets.get(interaction.user.id) || { type: 'all' };
  broadcastTargets.delete(interaction.user.id);

  await interaction.reply({ content: '📢 Envoi des MP en cours, cela peut prendre du temps…', ephemeral: true });

  const guild = interaction.guild;
  let recipients = [];

  if (target.type === 'all') {
    const members = await guild.members.fetch();
    recipients = [...members.values()];
  } else if (target.type === 'role') {
    await guild.members.fetch();
    const role = await guild.roles.fetch(target.roleId).catch(() => null);
    if (role) recipients = [...role.members.values()];
  } else if (target.type === 'users') {
    for (const id of target.userIds) {
      const m = await guild.members.fetch(id).catch(() => null);
      if (m) recipients.push(m);
    }
  }

  const components = buildDmComponents(guild);
  let success = 0;
  let failed = 0;

  for (const member of recipients) {
    if (member.user.bot) continue;
    const ok = await sendDmWithRetry(member, { content: message, components });
    if (ok) success++;
    else failed++;
    await new Promise(r => setTimeout(r, 350));
  }

  const targetLabel =
    target.type === 'all' ? 'tous les membres' : target.type === 'role' ? `le rôle <@&${target.roleId}>` : `${target.userIds.length} utilisateur(s) ciblé(s)`;

  logs.logFromInteraction(interaction, 'broadcast.sent', `${targetLabel} — ${success} envoyés, ${failed} échecs`);

  await interaction.followUp({
    content: `✅ Envoi terminé (${targetLabel}) : **${success}** MP envoyés, **${failed}** échecs (MP fermés ou bot).`,
    ephemeral: true
  });
}

/* ------------------------------------------------------------------ */
/*  CRÉATION D'ENQUÊTE                                                 */
/* ------------------------------------------------------------------ */

async function showNewSurveyModal(interaction) {
  const modal = new ModalBuilder().setCustomId('cfg:new_survey:modal').setTitle('Nouvelle enquête');
  const name = new TextInputBuilder().setCustomId('name').setLabel("Nom de l'enquête").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80);
  const description = new TextInputBuilder().setCustomId('description').setLabel('Description (affichée aux membres)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500);
  const maxResponses = new TextInputBuilder().setCustomId('max').setLabel('Réponses max par utilisateur (0 = illimité)').setStyle(TextInputStyle.Short).setRequired(false).setValue('1');
  const closeAt = new TextInputBuilder()
    .setCustomId('closeat')
    .setLabel('Clôture auto JJ/MM/AAAA HH:MM (vide = non)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
  modal.addComponents(
    new ActionRowBuilder().addComponents(name),
    new ActionRowBuilder().addComponents(description),
    new ActionRowBuilder().addComponents(maxResponses),
    new ActionRowBuilder().addComponents(closeAt)
  );
  await interaction.showModal(modal);
}

async function createSurvey(interaction) {
  const name = interaction.fields.getTextInputValue('name').trim();
  const description = interaction.fields.getTextInputValue('description')?.trim() || null;
  const maxRaw = interaction.fields.getTextInputValue('max')?.trim();
  const max = Number.isFinite(parseInt(maxRaw, 10)) ? parseInt(maxRaw, 10) : 1;
  const closeAtRaw = interaction.fields.getTextInputValue('closeat')?.trim();
  const closeAt = closeAtRaw ? parseDateTimeFR(closeAtRaw) : null;

  const info = db
    .prepare(
      `INSERT INTO surveys (guild_id, name, description, max_responses_per_user, status, close_at, created_by, created_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`
    )
    .run(interaction.guildId, name, description, max, closeAt, interaction.user.id, Date.now());

  logs.logFromInteraction(interaction, 'survey.create', name);

  const surveyId = info.lastInsertRowid;
  const warning = closeAtRaw && !closeAt ? '⚠️ Date de clôture invalide, ignorée (format attendu JJ/MM/AAAA HH:MM). ' : '';
  await showAnonymitySurveyStep(interaction, surveyId, warning);
}

async function showAnonymitySurveyStep(interaction, surveyId, prefix = '') {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('🎭 Anonymat des réponses')
    .setDescription(`${prefix}Comment les réponses à cette enquête doivent-elles être enregistrées ?`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:anonmode:${surveyId}:non`).setLabel('Non anonyme').setStyle(ButtonStyle.Primary).setEmoji('🙂'),
    new ButtonBuilder().setCustomId(`survey:anonmode:${surveyId}:choix`).setLabel('Au choix du membre').setStyle(ButtonStyle.Primary).setEmoji('🎭'),
    new ButtonBuilder().setCustomId(`survey:anonmode:${surveyId}:oui`).setLabel('Anonyme total').setStyle(ButtonStyle.Primary).setEmoji('🙈')
  );

  const payload = { embeds: [embed], components: [row] };
  if (interaction.replied || interaction.deferred) await interaction.followUp({ ...payload, ephemeral: true });
  else await interaction.reply({ ...payload, ephemeral: true });
}

async function handleAnonymityModeChoice(interaction, surveyId, mode) {
  db.prepare('UPDATE surveys SET anonymity_mode = ? WHERE id = ?').run(mode, surveyId);
  logs.logFromInteraction(interaction, 'survey.create', `anonymat = ${mode}`);

  const { embed, components } = buildSurveyBuilderPanel(surveyId);
  await interaction.update({ embeds: [embed], components });
}

function buildSurveyBuilderPanel(surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const questions = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position ASC').all(surveyId);

  const qList = questions.length
    ? questions.map((q, i) => `**${i + 1}.** ${q.label} \`${q.type}\`${q.type === 'choix' ? ` — options : ${JSON.parse(q.options || '[]').join(', ')}` : ''}`).join('\n')
    : '*Aucune question pour le moment.*';

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`🛠️ Construction : ${survey.name}`)
    .setDescription(survey.description || '*Pas de description*')
    .addFields(
      { name: 'Questions', value: qList },
      { name: 'Réponses max / utilisateur', value: String(survey.max_responses_per_user), inline: true },
      { name: 'Anonymat', value: ANONYMITY_LABELS[survey.anonymity_mode] || survey.anonymity_mode, inline: true },
      { name: 'Clôture auto', value: survey.close_at ? `<t:${Math.floor(survey.close_at / 1000)}:f>` : 'Aucune', inline: true }
    );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:addq:${surveyId}`).setLabel('Ajouter une question').setStyle(ButtonStyle.Primary).setEmoji('➕'),
    new ButtonBuilder().setCustomId(`survey:preview:${surveyId}`).setLabel('Aperçu').setStyle(ButtonStyle.Secondary).setEmoji('👁️'),
    new ButtonBuilder().setCustomId(`survey:closeat:${surveyId}`).setLabel('Clôture').setStyle(ButtonStyle.Secondary).setEmoji('📅'),
    new ButtonBuilder()
      .setCustomId(`survey:publish:${surveyId}`)
      .setLabel('Publier')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🚀')
      .setDisabled(questions.length === 0)
  );

  const components = [row1];

  if (questions.length) {
    const manageSelect = new StringSelectMenuBuilder()
      .setCustomId(`survey:manageq:${surveyId}`)
      .setPlaceholder('🛠️ Gérer une question (modifier / supprimer)')
      .addOptions(questions.slice(0, 25).map(q => ({ label: q.label.slice(0, 100), description: `Type : ${q.type}`, value: String(q.id) })));
    components.push(new ActionRowBuilder().addComponents(manageSelect));
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`survey:cancel:${surveyId}`).setLabel('Supprimer cette enquête').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cfg:back').setLabel('⬅️ Retour au panneau').setStyle(ButtonStyle.Secondary)
    )
  );

  return { embed, components };
}

/* --------------------- Aperçu avant publication ---------------------- */

async function previewSurvey(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const questions = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position ASC').all(surveyId);

  if (!questions.length) {
    return interaction.reply({ content: "❌ Ajoute au moins une question avant de prévisualiser.", ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📋 ${survey.name}`)
    .setDescription(survey.description || 'Clique sur le bouton ci-dessous pour répondre !')
    .setFooter({ text: `Aperçu • ${questions.length} question(s) • ${ANONYMITY_LABELS[survey.anonymity_mode]}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('preview:noop').setLabel('Répondre').setStyle(ButtonStyle.Success).setEmoji('📝').setDisabled(true)
  );

  await interaction.reply({
    content: "👁️ **Aperçu** — voici à quoi ressemblera le message publié (le bouton n'est pas fonctionnel ici) :",
    embeds: [embed],
    components: [row],
    ephemeral: true
  });
}

/* --------------------- Clôture programmée ---------------------- */

async function showCloseAtModal(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const current = survey.close_at
    ? new Date(survey.close_at)
    : null;
  const currentStr = current
    ? `${String(current.getDate()).padStart(2, '0')}/${String(current.getMonth() + 1).padStart(2, '0')}/${current.getFullYear()} ${String(current.getHours()).padStart(2, '0')}:${String(current.getMinutes()).padStart(2, '0')}`
    : '';

  const modal = new ModalBuilder().setCustomId(`survey:closeat:modal:${surveyId}`).setTitle('Clôture automatique');
  const input = new TextInputBuilder()
    .setCustomId('closeat')
    .setLabel('Date JJ/MM/AAAA HH:MM (vide = désactiver)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setValue(currentStr);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function saveCloseAt(interaction, surveyId) {
  const raw = interaction.fields.getTextInputValue('closeat')?.trim();
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);

  let closeAt = null;
  if (raw) {
    closeAt = parseDateTimeFR(raw);
    if (!closeAt) {
      return interaction.reply({ content: '❌ Format invalide. Utilise JJ/MM/AAAA HH:MM (ex : 25/12/2026 18:00).', ephemeral: true });
    }
  }

  db.prepare('UPDATE surveys SET close_at = ? WHERE id = ?').run(closeAt, surveyId);
  logs.logFromInteraction(interaction, 'survey.create', `clôture programmée pour l'enquête « ${survey.name} »`);

  if (survey.status === 'draft') {
    const { embed, components } = buildSurveyBuilderPanel(surveyId);
    await interaction.reply({ content: '✅ Clôture mise à jour.', embeds: [embed], components, ephemeral: true });
  } else {
    const { embed, components } = buildDashboard(surveyId);
    await interaction.reply({ content: '✅ Clôture mise à jour.', embeds: [embed], components, ephemeral: true });
  }
}

/* --------------------- Ajout / édition de question ------------------ */

const TYPE_LABELS = { texte: '📝 Texte libre', nombre: '🔢 Nombre', choix: '🔘 Choix multiple' };

function draftKey(userId, surveyId) {
  return `${userId}:${surveyId}`;
}

async function startAddQuestion(interaction, surveyId) {
  questionDrafts.set(draftKey(interaction.user.id, surveyId), { mode: 'add' });
  await showTypeStep(interaction, surveyId);
}

async function startEditQuestion(interaction, surveyId, questionId) {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId);
  if (!q) return interaction.reply({ content: '❌ Question introuvable.', ephemeral: true });

  questionDrafts.set(draftKey(interaction.user.id, surveyId), {
    mode: 'edit',
    questionId,
    label: q.label,
    options: q.options ? JSON.parse(q.options) : []
  });
  await showTypeStep(interaction, surveyId);
}

async function showTypeStep(interaction, surveyId) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('❓ Type de question')
    .setDescription('Quel type de réponse les membres devront-ils donner ?');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:qtype:${surveyId}:texte`).setLabel('Texte libre').setStyle(ButtonStyle.Primary).setEmoji('📝'),
    new ButtonBuilder().setCustomId(`survey:qtype:${surveyId}:nombre`).setLabel('Nombre').setStyle(ButtonStyle.Primary).setEmoji('🔢'),
    new ButtonBuilder().setCustomId(`survey:qtype:${surveyId}:choix`).setLabel('Choix multiple').setStyle(ButtonStyle.Primary).setEmoji('🔘')
  );
  const back = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:builder:${surveyId}`).setLabel('⬅️ Annuler').setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({ embeds: [embed], components: [row, back] });
}

async function handleTypeChoice(interaction, surveyId, type) {
  const draft = questionDrafts.get(draftKey(interaction.user.id, surveyId));
  if (!draft) return interaction.reply({ content: '❌ Session expirée, relance la création de la question.', ephemeral: true });
  draft.type = type;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('❓ Question obligatoire ?')
    .setDescription(`Type sélectionné : **${TYPE_LABELS[type]}**\n\nCette question doit-elle obligatoirement recevoir une réponse ?`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:qreq:${surveyId}:oui`).setLabel('Oui, obligatoire').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`survey:qreq:${surveyId}:non`).setLabel('Non, optionnelle').setStyle(ButtonStyle.Secondary)
  );
  const back = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:builder:${surveyId}`).setLabel('⬅️ Annuler').setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({ embeds: [embed], components: [row, back] });
}

async function handleRequiredChoice(interaction, surveyId, requiredValue) {
  const draft = questionDrafts.get(draftKey(interaction.user.id, surveyId));
  if (!draft) return interaction.reply({ content: '❌ Session expirée, relance la création de la question.', ephemeral: true });
  draft.required = requiredValue === 'oui' ? 1 : 0;

  const isEdit = draft.mode === 'edit';
  const modal = new ModalBuilder()
    .setCustomId(isEdit ? `survey:editq:modal:${surveyId}` : `survey:addq:modal:${surveyId}`)
    .setTitle(isEdit ? 'Modifier la question' : `Nouvelle question — ${TYPE_LABELS[draft.type]}`);

  const label = new TextInputBuilder()
    .setCustomId('label')
    .setLabel('Intitulé de la question')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(300)
    .setValue(draft.label || '');

  const rows = [new ActionRowBuilder().addComponents(label)];

  if (draft.type === 'choix') {
    const options = new TextInputBuilder()
      .setCustomId('options')
      .setLabel('Options (séparées par des virgules)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(500)
      .setValue((draft.options || []).join(', '));
    rows.push(new ActionRowBuilder().addComponents(options));
  }

  modal.addComponents(...rows);
  await interaction.showModal(modal);
}

async function addQuestion(interaction, surveyId) {
  const key = draftKey(interaction.user.id, surveyId);
  const draft = questionDrafts.get(key);
  if (!draft) return interaction.reply({ content: '❌ Session expirée, relance la création de la question.', ephemeral: true });

  const label = interaction.fields.getTextInputValue('label').trim();
  let optionsJson = null;

  if (draft.type === 'choix') {
    const raw = interaction.fields.getTextInputValue('options') || '';
    const opts = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 25);
    if (opts.length < 2) {
      return interaction.reply({ content: '❌ Une question de type "choix" doit avoir au moins 2 options séparées par des virgules.', ephemeral: true });
    }
    optionsJson = JSON.stringify(opts);
  }

  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM questions WHERE survey_id = ?').get(surveyId).p;
  db.prepare('INSERT INTO questions (survey_id, position, label, type, options, required) VALUES (?, ?, ?, ?, ?, ?)').run(
    surveyId,
    pos,
    label,
    draft.type,
    optionsJson,
    draft.required
  );

  logs.logFromInteraction(interaction, 'question.add', label);
  questionDrafts.delete(key);

  const { embed, components } = buildSurveyBuilderPanel(surveyId);
  await interaction.reply({ content: '✅ Question ajoutée.', embeds: [embed], components, ephemeral: true });
}

async function editQuestion(interaction, surveyId) {
  const key = draftKey(interaction.user.id, surveyId);
  const draft = questionDrafts.get(key);
  if (!draft || draft.mode !== 'edit') {
    return interaction.reply({ content: '❌ Session expirée, relance la modification.', ephemeral: true });
  }

  const label = interaction.fields.getTextInputValue('label').trim();
  let optionsJson = null;

  if (draft.type === 'choix') {
    const raw = interaction.fields.getTextInputValue('options') || '';
    const opts = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 25);
    if (opts.length < 2) {
      return interaction.reply({ content: '❌ Une question de type "choix" doit avoir au moins 2 options séparées par des virgules.', ephemeral: true });
    }
    optionsJson = JSON.stringify(opts);
  }

  db.prepare('UPDATE questions SET label = ?, type = ?, options = ?, required = ? WHERE id = ?').run(
    label,
    draft.type,
    optionsJson,
    draft.required,
    draft.questionId
  );

  logs.logFromInteraction(interaction, 'question.edit', label);
  questionDrafts.delete(key);

  const { embed, components } = buildSurveyBuilderPanel(surveyId);
  await interaction.reply({ content: '✅ Question modifiée.', embeds: [embed], components, ephemeral: true });
}

/* --------------------- Menu "Gérer une question" --------------------- */

async function manageQuestionSelect(interaction, surveyId) {
  const questionId = interaction.values[0];
  await showQuestionManagePanel(interaction, surveyId, questionId);
}

async function showQuestionManagePanel(interaction, surveyId, questionId) {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId);
  if (!q) return interaction.update({ content: '❌ Question introuvable.', embeds: [], components: [] });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🛠️ Gérer la question')
    .addFields(
      { name: 'Intitulé', value: q.label },
      { name: 'Type', value: TYPE_LABELS[q.type] || q.type, inline: true },
      { name: 'Obligatoire', value: q.required ? 'Oui' : 'Non', inline: true }
    );
  if (q.type === 'choix') {
    embed.addFields({ name: 'Options', value: JSON.parse(q.options || '[]').join(', ') || '*aucune*' });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:editq:${surveyId}:${questionId}`).setLabel('Modifier').setStyle(ButtonStyle.Primary).setEmoji('✏️'),
    new ButtonBuilder().setCustomId(`survey:delq2:${surveyId}:${questionId}`).setLabel('Supprimer').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
  );
  const back = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:builder:${surveyId}`).setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({ embeds: [embed], components: [row, back] });
}

async function confirmDeleteQuestion(interaction, surveyId, questionId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:delq2:confirm:${surveyId}:${questionId}`).setLabel('Oui, supprimer').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`survey:delq2:cancel:${surveyId}:${questionId}`).setLabel('Annuler').setStyle(ButtonStyle.Secondary)
  );
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('⚠️ Confirmation').setDescription('Supprimer définitivement cette question ?')],
    components: [row]
  });
}

async function executeDeleteQuestion(interaction, surveyId, questionId) {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId);
  db.prepare('DELETE FROM questions WHERE id = ?').run(questionId);
  logs.logFromInteraction(interaction, 'question.delete', q?.label);

  const { embed, components } = buildSurveyBuilderPanel(surveyId);
  await interaction.update({ embeds: [embed], components });
}

async function backToBuilder(interaction, surveyId) {
  questionDrafts.delete(draftKey(interaction.user.id, surveyId));
  const { embed, components } = buildSurveyBuilderPanel(surveyId);
  await interaction.update({ embeds: [embed], components });
}

async function cancelSurvey(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  db.prepare('DELETE FROM questions WHERE survey_id = ?').run(surveyId);
  db.prepare('DELETE FROM surveys WHERE id = ?').run(surveyId);
  logs.logFromInteraction(interaction, 'survey.delete', survey?.name);

  const { embed, components } = buildMainPanel(interaction.guildId);
  await interaction.update({ content: '🗑️ Enquête supprimée.', embeds: [embed], components });
}

async function publishSurvey(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const cfg = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(interaction.guildId);

  if (!cfg?.response_channel_id) {
    return interaction.reply({ content: '❌ Configure d\'abord un salon de réponses (bouton "Salon des réponses" dans le panneau principal).', ephemeral: true });
  }

  const channel = await interaction.guild.channels.fetch(cfg.response_channel_id).catch(() => null);
  if (!channel) {
    return interaction.reply({ content: '❌ Le salon configuré est introuvable. Reconfigure-le.', ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📋 ${survey.name}`)
    .setDescription(survey.description || 'Clique sur le bouton ci-dessous pour répondre !')
    .setFooter({ text: `Enquête • réponses max : ${survey.max_responses_per_user === 0 ? 'illimité' : survey.max_responses_per_user}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`resp:start:${surveyId}`).setLabel('Répondre').setStyle(ButtonStyle.Success).setEmoji('📝')
  );

  const msg = await channel.send({ embeds: [embed], components: [row] });

  db.prepare("UPDATE surveys SET status = 'active', channel_id = ?, message_id = ? WHERE id = ?").run(channel.id, msg.id, surveyId);
  logs.logFromInteraction(interaction, 'survey.publish', survey.name);

  const { embed: mainEmbed, components } = buildMainPanel(interaction.guildId);
  await interaction.reply({ content: `🚀 Enquête publiée dans <#${channel.id}> !`, embeds: [mainEmbed], components, ephemeral: true });
}

/* ------------------------------------------------------------------ */
/*  LISTE DES ENQUÊTES (avec pagination)                                */
/* ------------------------------------------------------------------ */

async function showSurveyList(interaction, page = 0) {
  const all = db.prepare('SELECT * FROM surveys WHERE guild_id = ? ORDER BY created_at DESC').all(interaction.guildId);

  if (!all.length) {
    const back = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cfg:back').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)
    );
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📋 Enquêtes').setDescription("Aucune enquête n'a encore été créée.")],
      components: [back]
    });
  }

  const totalPages = Math.max(1, Math.ceil(all.length / SURVEYS_PER_PAGE));
  page = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = all.slice(page * SURVEYS_PER_PAGE, page * SURVEYS_PER_PAGE + SURVEYS_PER_PAGE);

  const statusEmoji = { draft: '📝', active: '🟢', closed: '🔴' };
  const select = new StringSelectMenuBuilder()
    .setCustomId('cfg:survey:select')
    .setPlaceholder('Choisis une enquête à gérer')
    .addOptions(pageItems.map(s => ({ label: s.name.slice(0, 100), description: `${statusEmoji[s.status] || ''} ${s.status}`, value: String(s.id) })));

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cfg:survey:list:${page - 1}`).setLabel('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId('cfg:back').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`cfg:survey:list:${page + 1}`).setLabel('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1)
  );

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📋 Enquêtes')
        .setDescription('Sélectionne une enquête pour voir son tableau de bord.')
        .setFooter({ text: `Page ${page + 1}/${totalPages} • ${all.length} enquête(s)` })
    ],
    components: [new ActionRowBuilder().addComponents(select), navRow]
  });
}

async function openSurveyFromSelect(interaction) {
  const surveyId = interaction.values[0];
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  if (!survey) return interaction.update({ content: 'Enquête introuvable.', embeds: [], components: [] });

  if (survey.status === 'draft') {
    const { embed, components } = buildSurveyBuilderPanel(surveyId);
    return interaction.update({ embeds: [embed], components });
  }
  const { embed, components } = buildDashboard(surveyId);
  await interaction.update({ embeds: [embed], components });
}

/* ------------------------------------------------------------------ */
/*  DASHBOARD (avec graphiques texte + pagination des questions)        */
/* ------------------------------------------------------------------ */

function buildDashboard(surveyId, page = 0) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const questions = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position ASC').all(surveyId);
  const responseCount = db.prepare('SELECT COUNT(*) c FROM responses WHERE survey_id = ?').get(surveyId).c;

  const totalPages = Math.max(1, Math.ceil(questions.length / DASHBOARD_QUESTIONS_PER_PAGE));
  page = Math.max(0, Math.min(page, totalPages - 1));
  const pageQuestions = questions.slice(page * DASHBOARD_QUESTIONS_PER_PAGE, page * DASHBOARD_QUESTIONS_PER_PAGE + DASHBOARD_QUESTIONS_PER_PAGE);

  const fields = [
    { name: 'Statut', value: survey.status === 'active' ? '🟢 Active' : '🔴 Fermée', inline: true },
    { name: 'Réponses reçues', value: String(responseCount), inline: true },
    { name: 'Anonymat', value: ANONYMITY_LABELS[survey.anonymity_mode] || survey.anonymity_mode, inline: true },
    { name: 'Salon', value: survey.channel_id ? `<#${survey.channel_id}>` : '—', inline: true },
    { name: 'Clôture auto', value: survey.close_at ? `<t:${Math.floor(survey.close_at / 1000)}:R>` : 'Aucune', inline: true }
  ];

  for (const q of pageQuestions) {
    if (q.type === 'choix') {
      const counts = db.prepare('SELECT value, COUNT(*) c FROM answers WHERE question_id = ? GROUP BY value ORDER BY c DESC').all(q.id);
      const total = counts.reduce((sum, c) => sum + c.c, 0);
      const breakdown = counts.length
        ? counts.map(c => `${c.value} — **${c.c}** (${total ? Math.round((c.c / total) * 100) : 0}%)\n\`${renderBar(total ? (c.c / total) * 100 : 0)}\``).join('\n')
        : '*Pas de réponse*';
      fields.push({ name: `❓ ${q.label}`, value: breakdown.slice(0, 1024) });
    } else {
      const count = db.prepare('SELECT COUNT(*) c FROM answers WHERE question_id = ?').get(q.id).c;
      fields.push({ name: `❓ ${q.label}`, value: `${count} réponse(s) — export CSV pour le détail` });
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📊 Tableau de bord : ${survey.name}`)
    .addFields(fields.slice(0, 25))
    .setFooter({ text: `Questions — page ${page + 1}/${totalPages}` });

  const row1 = new ActionRowBuilder().addComponents(
    survey.status === 'active'
      ? new ButtonBuilder().setCustomId(`survey:deactivate:${surveyId}`).setLabel('Clôturer').setStyle(ButtonStyle.Danger).setEmoji('🔒')
      : new ButtonBuilder().setCustomId(`survey:activate:${surveyId}`).setLabel('Réactiver').setStyle(ButtonStyle.Success).setEmoji('🔓'),
    new ButtonBuilder().setCustomId(`survey:export:${surveyId}`).setLabel('Exporter (CSV)').setStyle(ButtonStyle.Secondary).setEmoji('📤'),
    new ButtonBuilder().setCustomId(`survey:duplicate:${surveyId}`).setLabel('Dupliquer').setStyle(ButtonStyle.Secondary).setEmoji('📄'),
    new ButtonBuilder().setCustomId(`survey:closeat:${surveyId}`).setLabel('Clôture').setStyle(ButtonStyle.Secondary).setEmoji('📅'),
    new ButtonBuilder().setCustomId(`survey:delete:${surveyId}`).setLabel('Supprimer').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
  );

  const components = [row1];

  if (totalPages > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`survey:dash:page:${surveyId}:${page - 1}`).setLabel('◀️ Questions').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId(`survey:dash:page:${surveyId}:${page + 1}`).setLabel('Questions ▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1)
      )
    );
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cfg:manage_surveys').setLabel('⬅️ Liste des enquêtes').setStyle(ButtonStyle.Secondary)
    )
  );

  return { embed, components };
}

async function showDashboardPage(interaction, surveyId, page) {
  const { embed, components } = buildDashboard(surveyId, page);
  await interaction.update({ embeds: [embed], components });
}

async function setSurveyStatus(interaction, surveyId, status) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  db.prepare('UPDATE surveys SET status = ? WHERE id = ?').run(status, surveyId);
  logs.logFromInteraction(interaction, status === 'active' ? 'survey.activate' : 'survey.deactivate', survey?.name);

  const { embed, components } = buildDashboard(surveyId);
  await interaction.update({ embeds: [embed], components });
}

async function confirmDeleteSurvey(interaction, surveyId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:delete:confirm:${surveyId}`).setLabel('Oui, supprimer définitivement').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`survey:delete:cancel:${surveyId}`).setLabel('Annuler').setStyle(ButtonStyle.Secondary)
  );
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('⚠️ Confirmation').setDescription('Supprimer cette enquête effacera aussi toutes ses réponses. Confirmer ?')],
    components: [row]
  });
}

async function deleteSurvey(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const qids = db.prepare('SELECT id FROM questions WHERE survey_id = ?').all(surveyId).map(r => r.id);
  const rids = db.prepare('SELECT id FROM responses WHERE survey_id = ?').all(surveyId).map(r => r.id);
  if (qids.length) db.prepare(`DELETE FROM answers WHERE question_id IN (${qids.map(() => '?').join(',')})`).run(...qids);
  if (rids.length) db.prepare(`DELETE FROM responses WHERE id IN (${rids.map(() => '?').join(',')})`).run(...rids);
  db.prepare('DELETE FROM questions WHERE survey_id = ?').run(surveyId);
  db.prepare('DELETE FROM response_sessions WHERE survey_id = ?').run(surveyId);
  db.prepare('DELETE FROM surveys WHERE id = ?').run(surveyId);
  logs.logFromInteraction(interaction, 'survey.delete', survey?.name);

  await showSurveyList(interaction);
}

async function duplicateSurvey(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const questions = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position ASC').all(surveyId);

  const info = db
    .prepare(
      `INSERT INTO surveys (guild_id, name, description, max_responses_per_user, status, anonymity_mode, close_at, created_by, created_at)
       VALUES (?, ?, ?, ?, 'draft', ?, NULL, ?, ?)`
    )
    .run(survey.guild_id, `${survey.name} (copie)`, survey.description, survey.max_responses_per_user, survey.anonymity_mode, interaction.user.id, Date.now());

  const newSurveyId = info.lastInsertRowid;
  const insertQ = db.prepare('INSERT INTO questions (survey_id, position, label, type, options, required) VALUES (?, ?, ?, ?, ?, ?)');
  for (const q of questions) {
    insertQ.run(newSurveyId, q.position, q.label, q.type, q.options, q.required);
  }

  logs.logFromInteraction(interaction, 'survey.duplicate', `${survey.name} → ${survey.name} (copie)`);

  const { embed, components } = buildSurveyBuilderPanel(newSurveyId);
  await interaction.reply({ content: '📄 Enquête dupliquée en brouillon, modifiable ci-dessous.', embeds: [embed], components, ephemeral: true });
}

async function exportSurvey(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const questions = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position ASC').all(surveyId);
  const responses = db.prepare('SELECT * FROM responses WHERE survey_id = ? ORDER BY created_at ASC').all(surveyId);

  const header = ['utilisateur', 'anonyme', 'date', ...questions.map(q => q.label)].map(toCsvValue).join(';');
  const lines = [header];

  for (const r of responses) {
    const answers = db.prepare('SELECT * FROM answers WHERE response_id = ?').all(r.id);
    const byQ = Object.fromEntries(answers.map(a => [a.question_id, a.value]));
    const userDisplay = r.is_anonymous ? 'Anonyme' : r.user_id;
    const row = [userDisplay, r.is_anonymous ? 'oui' : 'non', new Date(r.created_at).toISOString(), ...questions.map(q => byQ[q.id] ?? '')];
    lines.push(row.map(toCsvValue).join(';'));
  }

  const buffer = Buffer.from(lines.join('\n'), 'utf-8');
  const attachment = new AttachmentBuilder(buffer, { name: `${survey.name.replace(/[^a-z0-9]+/gi, '_')}.csv` });

  logs.logFromInteraction(interaction, 'survey.export', survey.name);
  await interaction.reply({ content: `📤 Export de **${survey.name}**`, files: [attachment], ephemeral: true });
}

/* ------------------------------------------------------------------ */
/*  GESTION DES DONNÉES (RGPD) : par utilisateur / par enquête          */
/* ------------------------------------------------------------------ */

async function showDataPanel(interaction) {
  const guildId = interaction.guildId;
  const totalResponses = db
    .prepare('SELECT COUNT(*) c FROM responses r JOIN surveys s ON r.survey_id = s.id WHERE s.guild_id = ?')
    .get(guildId).c;
  const distinctUsers = db
    .prepare("SELECT COUNT(DISTINCT r.user_id) c FROM responses r JOIN surveys s ON r.survey_id = s.id WHERE s.guild_id = ? AND r.is_anonymous = 0")
    .get(guildId).c;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🗄️ Gestion des données')
    .setDescription(
      `**${totalResponses}** réponse(s) stockée(s) au total, pour **${distinctUsers}** utilisateur(s) identifié(s) (hors réponses anonymes).\n\n` +
        "Un membre souhaite que ses réponses soient supprimées ? Sélectionne-le ci-dessous.\nTu peux aussi vider entièrement les réponses d'une enquête sans la supprimer."
    );

  const userSelect = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId('cfg:data:user').setPlaceholder('🧑 Supprimer les données d\'un utilisateur').setMaxValues(1)
  );

  const surveys = db.prepare('SELECT id, name FROM surveys WHERE guild_id = ?').all(guildId);
  const components = [userSelect];
  if (surveys.length) {
    const surveySelect = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('cfg:data:survey')
        .setPlaceholder("📋 Vider les réponses d'une enquête")
        .addOptions(surveys.slice(0, 25).map(s => ({ label: s.name.slice(0, 100), value: String(s.id) })))
    );
    components.push(surveySelect);
  }
  components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:back').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)));

  await interaction.update({ embeds: [embed], components });
}

async function selectDataUser(interaction) {
  const userId = interaction.values[0];
  const count = db
    .prepare("SELECT COUNT(*) c FROM responses r JOIN surveys s ON r.survey_id = s.id WHERE s.guild_id = ? AND r.user_id = ? AND r.is_anonymous = 0")
    .get(interaction.guildId, userId).c;

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('⚠️ Confirmation')
    .setDescription(`Supprimer définitivement les **${count}** réponse(s) de <@${userId}> sur toutes les enquêtes de ce serveur ?\n\n*Les réponses envoyées anonymement ne peuvent pas être liées à un utilisateur et ne sont pas concernées.*`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cfg:data:user:confirm:${userId}`).setLabel('Oui, supprimer').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cfg:data').setLabel('Annuler').setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

async function executeDataUserDeletion(interaction, userId) {
  const guildId = interaction.guildId;
  const responseIds = db
    .prepare("SELECT r.id FROM responses r JOIN surveys s ON r.survey_id = s.id WHERE s.guild_id = ? AND r.user_id = ? AND r.is_anonymous = 0")
    .all(guildId, userId)
    .map(r => r.id);

  if (responseIds.length) {
    db.prepare(`DELETE FROM answers WHERE response_id IN (${responseIds.map(() => '?').join(',')})`).run(...responseIds);
    db.prepare(`DELETE FROM responses WHERE id IN (${responseIds.map(() => '?').join(',')})`).run(...responseIds);
  }
  db.prepare(
    `DELETE FROM response_sessions WHERE user_id = ? AND survey_id IN (SELECT id FROM surveys WHERE guild_id = ?)`
  ).run(userId, guildId);

  logs.logFromInteraction(interaction, 'data.user.delete', `<@${userId}> — ${responseIds.length} réponse(s)`);

  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Données supprimées').setDescription(`${responseIds.length} réponse(s) de <@${userId}> ont été supprimées.`)],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:data').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary))]
  });
}

async function selectDataSurvey(interaction) {
  const surveyId = interaction.values[0];
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const count = db.prepare('SELECT COUNT(*) c FROM responses WHERE survey_id = ?').get(surveyId).c;

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('⚠️ Confirmation')
    .setDescription(`Vider les **${count}** réponse(s) de l'enquête **${survey.name}** ? L'enquête et ses questions seront conservées, seules les réponses seront supprimées.`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cfg:data:survey:confirm:${surveyId}`).setLabel('Oui, vider les réponses').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cfg:data').setLabel('Annuler').setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

async function executeDataSurveyClear(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const rids = db.prepare('SELECT id FROM responses WHERE survey_id = ?').all(surveyId).map(r => r.id);
  if (rids.length) {
    db.prepare(`DELETE FROM answers WHERE response_id IN (${rids.map(() => '?').join(',')})`).run(...rids);
    db.prepare(`DELETE FROM responses WHERE id IN (${rids.map(() => '?').join(',')})`).run(...rids);
  }
  db.prepare('DELETE FROM response_sessions WHERE survey_id = ?').run(surveyId);
  logs.logFromInteraction(interaction, 'data.survey.clear', `${survey?.name} — ${rids.length} réponse(s)`);

  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Réponses supprimées').setDescription(`${rids.length} réponse(s) de **${survey?.name}** ont été supprimées.`)],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:data').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary))]
  });
}

/* ------------------------------------------------------------------ */
/*  JOURNAL D'AUDIT                                                     */
/* ------------------------------------------------------------------ */

async function showLogsPanel(interaction, page = 0) {
  const guildId = interaction.guildId;
  const total = logs.countLogs(guildId);
  const totalPages = Math.max(1, Math.ceil(total / LOGS_PER_PAGE));
  page = Math.max(0, Math.min(page, totalPages - 1));
  const entries = logs.getRecentLogs(guildId, LOGS_PER_PAGE, page * LOGS_PER_PAGE);

  const description = entries.length
    ? entries
        .map(e => {
          const label = logs.ACTION_LABELS[e.action] || e.action;
          const who = e.actor_id ? `<@${e.actor_id}>` : 'Système';
          const when = `<t:${Math.floor(e.created_at / 1000)}:R>`;
          return `${label} — ${who} — ${when}${e.details ? `\n> ${e.details}` : ''}`;
        })
        .join('\n\n')
    : '*Aucune action enregistrée pour le moment.*';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📜 Journal d\'audit')
    .setDescription(description)
    .setFooter({ text: `Page ${page + 1}/${totalPages} • ${total} entrée(s)` });

  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cfg:logs:${page - 1}`).setLabel('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId('cfg:back').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`cfg:logs:${page + 1}`).setLabel('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1)
  );

  await interaction.update({ embeds: [embed], components: [nav] });
}

/* ------------------------------------------------------------------ */

module.exports = {
  buildMainPanel,
  showChannelSelect,
  setChannel,
  showWhitelistPanel,
  whitelistAdd,
  whitelistRemove,
  toggleDmOnJoin,
  saveDmJoinMessage,
  buildDmComponents,
  handleDmDelete,
  showPresetPanel,
  handlePresetSelect,
  showBroadcastTargetPanel,
  selectBroadcastAll,
  selectBroadcastRole,
  selectBroadcastUsers,
  runBroadcast,
  showNewSurveyModal,
  createSurvey,
  showAnonymitySurveyStep,
  handleAnonymityModeChoice,
  buildSurveyBuilderPanel,
  previewSurvey,
  showCloseAtModal,
  saveCloseAt,
  startAddQuestion,
  startEditQuestion,
  handleTypeChoice,
  handleRequiredChoice,
  addQuestion,
  editQuestion,
  manageQuestionSelect,
  showQuestionManagePanel,
  confirmDeleteQuestion,
  executeDeleteQuestion,
  backToBuilder,
  cancelSurvey,
  publishSurvey,
  showSurveyList,
  openSurveyFromSelect,
  buildDashboard,
  showDashboardPage,
  setSurveyStatus,
  confirmDeleteSurvey,
  deleteSurvey,
  duplicateSurvey,
  exportSurvey,
  showDataPanel,
  selectDataUser,
  executeDataUserDeletion,
  selectDataSurvey,
  executeDataSurveyClear,
  showLogsPanel
};
