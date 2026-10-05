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
  AttachmentBuilder,
  MessageFlags
} = require('discord.js');
const db = require('./database');
const logs = require('./logs');
const perms = require('./permissions');
const messages = require('./messages');
const flow = require('./responseFlow');
const logger = require('./logger');
const {
  broadcastTargets,
  broadcastDrafts,
  logFilters,
  questionDrafts,
  DM_PRESETS,
  ANONYMITY_LABELS,
  ANONYMITY_LABELS_SHORT,
  getAnonymityModes,
  describeAnonymityModes,
  SURVEY_TEMPLATES,
  toCsvValue,
  chunk,
  parseDateTimeFR,
  renderBar,
  truncateField,
  substituteVariables,
  MP_VARIABLES
} = require('./utils');

const SURVEYS_PER_PAGE = 25;
const DASHBOARD_QUESTIONS_PER_PAGE = 8;
const LOGS_PER_PAGE = 10;
const BIG_BROADCAST_THRESHOLD = 200;

// Discord n'autorise pas d'éditer un message dont l'interaction n'est pas
// "issue" de ce message (ex: modal ouvert depuis une commande directe plutôt
// qu'un bouton). On préfère systématiquement modifier le message existant
// plutôt que d'en renvoyer un nouveau, quand c'est possible.
async function respondPreferUpdate(interaction, payload) {
  if (interaction.isFromMessage && interaction.isFromMessage()) {
    return interaction.update(payload);
  }
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

/* ------------------------------------------------------------------ */
/*  PANNEAU PRINCIPAL (adapté aux permissions du membre)                */
/* ------------------------------------------------------------------ */

function buildModeChooserPanel(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📊 Tableau de bord — Enquêtes')
    .setDescription('Choisis le mode que tu veux ouvrir :')
    .addFields(
      { name: '🔧 Mode gestion', value: 'Configurer et gérer les enquêtes du serveur.', inline: true },
      { name: '👤 Mode utilisateur', value: 'Voir, modifier ou supprimer tes propres réponses.', inline: true }
    )
    .setFooter({ text: 'Ce panneau est visible uniquement par toi.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mode:admin').setLabel('Mode gestion').setStyle(ButtonStyle.Primary).setEmoji('🔧'),
    new ButtonBuilder().setCustomId('mode:user').setLabel('Mode utilisateur').setStyle(ButtonStyle.Secondary).setEmoji('👤')
  );

  return { embed, components: [row] };
}

function buildMainPanel(interaction) {
  const guildId = interaction.guildId;
  const cfg = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId) || {};
  const surveyCount = db.prepare("SELECT COUNT(*) c FROM surveys WHERE guild_id = ? AND (archived IS NULL OR archived = 0) AND is_template = 0").get(guildId).c;
  const activeCount = db.prepare("SELECT COUNT(*) c FROM surveys WHERE guild_id = ? AND status = 'active' AND (archived IS NULL OR archived = 0) AND is_template = 0").get(guildId).c;
  const totalResponses = db
    .prepare("SELECT COUNT(*) c FROM responses r JOIN surveys s ON r.survey_id = s.id WHERE s.guild_id = ? AND (s.archived IS NULL OR s.archived = 0) AND s.is_template = 0")
    .get(guildId).c;

  const canSurveys = perms.hasPerm(interaction, perms.PERMS.MANAGE_SURVEYS);
  const canMpAll = perms.hasPerm(interaction, perms.PERMS.MP_ALL);
  const canMp = perms.hasPerm(interaction, perms.PERMS.MANAGE_MP);
  const canWelcome = perms.hasPerm(interaction, perms.PERMS.MANAGE_MP_WELCOME);
  const canLogs = perms.hasPerm(interaction, perms.PERMS.VIEW_LOGS);
  const canData = perms.hasPerm(interaction, perms.PERMS.MANAGE_DATA);
  const canManagePerms = perms.canManagePermissions(interaction);
  const isManager = perms.isOwner(interaction);

  const embed = new EmbedBuilder()
    .setTitle('📊 Tableau de bord — Enquêtes')
    .setColor(0x5865f2)
    .setFooter({ text: 'Ce panneau est visible uniquement par toi.' });

  const fields = [];
  if (canSurveys) {
    fields.push(
      { name: '📨 Salon des réponses', value: cfg.response_channel_id ? `<#${cfg.response_channel_id}>` : '*Non configuré*', inline: true },
      { name: '📥 Salon de réception', value: cfg.responses_log_channel_id ? `<#${cfg.responses_log_channel_id}>` : '*Non configuré*', inline: true },
      { name: '📋 Enquêtes', value: `${activeCount} active(s) / ${surveyCount} au total`, inline: true },
      { name: '📊 Réponses reçues', value: `${totalResponses} au total`, inline: true }
    );
  }
  if (canWelcome) {
    fields.push({ name: '👋 MP de bienvenue', value: cfg.dm_on_join ? '✅ Activé' : '❌ Désactivé', inline: true });
  }
  if (isManager || canManagePerms) {
    const permCount = perms.getUsersWithAnyPerm(guildId).length;
    fields.push({ name: '🔑 Permissions déléguées', value: `${permCount} membre(s)`, inline: true });
  }
  if (fields.length) embed.addFields(fields);
  else embed.setDescription("Tu n'as pour l'instant accès à aucune section. Demande à un responsable du serveur de t'attribuer une permission.");

  const surveyRow = [];
  const commRow = [];
  const adminRow = [];

  if (canSurveys) {
    surveyRow.push(
      new ButtonBuilder().setCustomId('cfg:surveys').setLabel('Gestion des enquêtes').setStyle(ButtonStyle.Success).setEmoji('📋'),
      new ButtonBuilder().setCustomId('cfg:channels').setLabel('Salons').setStyle(ButtonStyle.Primary).setEmoji('📨')
    );
  }
  if (canMpAll || canMp) {
    commRow.push(new ButtonBuilder().setCustomId('cfg:broadcast').setLabel('Envoyer un MP').setStyle(ButtonStyle.Danger).setEmoji('📢'));
  }
  if (canWelcome) {
    commRow.push(new ButtonBuilder().setCustomId('cfg:welcome').setLabel('MP de bienvenue').setStyle(ButtonStyle.Secondary).setEmoji('👋'));
  }
  if (canLogs) adminRow.push(new ButtonBuilder().setCustomId('cfg:logs:0').setLabel('Journal').setStyle(ButtonStyle.Secondary).setEmoji('📜'));
  if (canData) adminRow.push(new ButtonBuilder().setCustomId('cfg:data').setLabel('Gérer les données').setStyle(ButtonStyle.Secondary).setEmoji('🗄️'));
  if (canSurveys) adminRow.push(new ButtonBuilder().setCustomId('cfg:stats').setLabel('Statistiques').setStyle(ButtonStyle.Secondary).setEmoji('📊'));
  if (isManager || canManagePerms) adminRow.push(new ButtonBuilder().setCustomId('cfg:perm').setLabel('Permissions').setStyle(ButtonStyle.Secondary).setEmoji('🔑'));

  const modeRow = [new ButtonBuilder().setCustomId('mode:user').setLabel('Mode utilisateur').setStyle(ButtonStyle.Secondary).setEmoji('👤')];

  // Chaque groupe logique (enquêtes / communication / administration) démarre sur
  // sa propre ligne. Statistiques est positionné juste après "Gérer les données".
  // Le mode utilisateur (gestion de ses propres réponses) est toujours accessible,
  // sur sa propre ligne en bas de panneau.
  const components = [];
  for (const group of [surveyRow, commRow, adminRow, modeRow]) {
    if (!group.length) continue;
    for (const rowButtons of chunk(group, 5)) {
      components.push(new ActionRowBuilder().addComponents(rowButtons));
    }
  }
  return { embed, components };
}

/* ------------------------------------------------------------------ */
/*  STATISTIQUES GLOBALES                                               */
/* ------------------------------------------------------------------ */

async function showGlobalStats(interaction, filter = 'all') {
  const guildId = interaction.guildId;
  // Les enquêtes archivées ne comptent plus dans les statistiques globales.
  const byStatus = db.prepare("SELECT status, COUNT(*) c FROM surveys WHERE guild_id = ? AND (archived IS NULL OR archived = 0) AND is_template = 0 GROUP BY status").all(guildId);
  const statusMap = Object.fromEntries(byStatus.map(r => [r.status, r.c]));
  const totalSurveys = byStatus.reduce((s, r) => s + r.c, 0);
  const archivedCount = db.prepare('SELECT COUNT(*) c FROM surveys WHERE guild_id = ? AND archived = 1').get(guildId).c;

  const filterLabels = { all: 'Toutes', active: '🟢 Actives', draft: '📝 Brouillons', closed: '🔴 Fermées' };
  const statusClause = filter === 'all' ? '' : 'AND s.status = ?';
  const params = filter === 'all' ? [guildId] : [guildId, filter];
  const archivedClause = "AND (s.archived IS NULL OR s.archived = 0) AND s.is_template = 0";

  const totalResponses = db
    .prepare(`SELECT COUNT(*) c FROM responses r JOIN surveys s ON r.survey_id = s.id WHERE s.guild_id = ? ${archivedClause} ${statusClause}`)
    .get(...params).c;
  const totalAnonymous = db
    .prepare(`SELECT COUNT(*) c FROM responses r JOIN surveys s ON r.survey_id = s.id WHERE s.guild_id = ? AND r.is_anonymous = 1 ${archivedClause} ${statusClause}`)
    .get(...params).c;
  const topSurveys = db
    .prepare(`SELECT s.name, COUNT(r.id) c FROM surveys s LEFT JOIN responses r ON r.survey_id = s.id WHERE s.guild_id = ? ${archivedClause} ${statusClause} GROUP BY s.id ORDER BY c DESC LIMIT 5`)
    .all(...params);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📊 Statistiques globales')
    .setDescription(`Filtre actif : **${filterLabels[filter]}**${archivedCount ? `\n🗄️ ${archivedCount} enquête(s) archivée(s) — exclue(s) de ces statistiques.` : ''}`)
    .addFields(
      { name: 'Enquêtes actives', value: String(statusMap.active || 0), inline: true },
      { name: 'Enquêtes brouillon', value: String(statusMap.draft || 0), inline: true },
      { name: 'Enquêtes fermées', value: String(statusMap.closed || 0), inline: true },
      { name: 'Total enquêtes', value: String(totalSurveys), inline: true },
      { name: `Réponses (${filterLabels[filter]})`, value: String(totalResponses), inline: true },
      { name: 'Dont anonymes', value: String(totalAnonymous), inline: true },
      {
        name: `🏆 Classement (${filterLabels[filter]})`,
        value: topSurveys.length && topSurveys.some(s => s.c > 0) ? topSurveys.map((s, i) => `${i + 1}. ${s.name} — **${s.c}** réponse(s)`).join('\n') : '*Aucune réponse pour ce filtre*'
      }
    );

  const filterSelect = new StringSelectMenuBuilder()
    .setCustomId('cfg:stats:filter')
    .setPlaceholder('Filtrer par statut')
    .addOptions(Object.entries(filterLabels).map(([value, label]) => ({ label, value, default: value === filter })));

  const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:back').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary));
  await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(filterSelect), back] });
}

async function handleStatsFilter(interaction) {
  await showGlobalStats(interaction, interaction.values[0]);
}

/* ------------------------------------------------------------------ */
/*  SALON DES RÉPONSES                                                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  SALONS (réponses + réception) — regroupés sur un même écran         */
/* ------------------------------------------------------------------ */

async function showChannelsPanel(interaction) {
  const cfg = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(interaction.guildId);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📨 Salons')
    .setDescription("Deux salons distincts peuvent être configurés :")
    .addFields(
      { name: '📨 Salon des réponses', value: cfg?.response_channel_id ? `<#${cfg.response_channel_id}>` : '*Non configuré*', inline: true },
      { name: '📥 Salon de réception', value: cfg?.responses_log_channel_id ? `<#${cfg.responses_log_channel_id}>` : '*Non configuré*', inline: true }
    )
    .setFooter({ text: 'Salon des réponses = où l\'enquête est publiée. Salon de réception = feed en direct des réponses reçues.' });

  const responseSelect = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId('cfg:channel:select').setPlaceholder('📨 Choisir le salon des réponses').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  );
  const logSelect = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId('cfg:logchannel:select').setPlaceholder('📥 Choisir le salon de réception').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  );
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfg:channel:clear').setLabel('Désactiver l\'annonce').setStyle(ButtonStyle.Danger).setDisabled(!cfg?.response_channel_id),
    new ButtonBuilder().setCustomId('cfg:logchannel:clear').setLabel('Désactiver la réception').setStyle(ButtonStyle.Danger).setDisabled(!cfg?.responses_log_channel_id),
    new ButtonBuilder().setCustomId('cfg:back').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({ embeds: [embed], components: [responseSelect, logSelect, buttons] });
}

async function clearResponseChannel(interaction) {
  db.prepare(`UPDATE guild_config SET response_channel_id = NULL WHERE guild_id = ?`).run(interaction.guildId);
  logs.logFromInteraction(interaction, 'config.channel', "Salon d'annonce des enquêtes désactivé");
  await showChannelsPanel(interaction);
}

async function setChannel(interaction) {
  const channelId = interaction.values[0];
  db.prepare(
    `INSERT INTO guild_config (guild_id, response_channel_id) VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET response_channel_id = excluded.response_channel_id`
  ).run(interaction.guildId, channelId);
  logs.logFromInteraction(interaction, 'config.channel', `Salon des réponses : <#${channelId}>`);
  await showChannelsPanel(interaction);
}

async function setResponsesLogChannel(interaction) {
  const channelId = interaction.values[0];
  db.prepare(
    `INSERT INTO guild_config (guild_id, responses_log_channel_id) VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET responses_log_channel_id = excluded.responses_log_channel_id`
  ).run(interaction.guildId, channelId);
  logs.logFromInteraction(interaction, 'config.channel', `Salon de réception des réponses : <#${channelId}>`);
  await showChannelsPanel(interaction);
}

async function clearResponsesLogChannel(interaction) {
  db.prepare(`UPDATE guild_config SET responses_log_channel_id = NULL WHERE guild_id = ?`).run(interaction.guildId);
  logs.logFromInteraction(interaction, 'config.channel', 'Salon de réception des réponses désactivé');
  await showChannelsPanel(interaction);
}

/* ------------------------------------------------------------------ */
/*  GESTION DES PERMISSIONS (réservé "Gérer le serveur")               */
/* ------------------------------------------------------------------ */

async function showPermissionsPanel(interaction) {
  const guildId = interaction.guildId;
  const ownerId = interaction.guild.ownerId;
  const userIds = perms.getUsersWithAnyPerm(guildId).filter(uid => uid !== ownerId);

  const lines = userIds.length
    ? userIds
        .map(uid => {
          const p = perms.getUserPerms(guildId, uid);
          return `<@${uid}> — ${p.map(x => perms.PERM_LABELS[x]).join(', ')}`;
        })
        .join('\n')
    : '*Personne d\'autre n\'a de permission pour l\'instant.*';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🔑 Gestion des permissions')
    .setDescription(
      "Seul le **propriétaire du serveur** a automatiquement accès à tout — aucune permission Discord ne donne plus accès au bot. " +
        "Tout autre membre doit recevoir ses permissions explicitement ci-dessous.\n\n" +
        `**👑 <@${ownerId}>** — propriétaire : toutes les permissions (verrouillé)\n\n**Autres membres :**\n` +
        lines
    );

  const select = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId('cfg:perm:select').setPlaceholder('Choisis un membre à gérer').setMaxValues(1)
  );
  const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:back').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary));

  await interaction.update({ embeds: [embed], components: [select, back] });
}

function buildUserPermissionsPanel(guildId, userId, ownerId = null) {
  const isOwnerTarget = !!ownerId && userId === ownerId;
  const current = isOwnerTarget ? perms.ALL_PERMS : perms.getUserPerms(guildId, userId);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🔑 Permissions de <@${userId}>`)
    .setDescription(
      isOwnerTarget
        ? '👑 Propriétaire du serveur : toutes les permissions sont accordées en permanence et **ne peuvent pas être modifiées**.'
        : "Clique sur une permission pour l'activer ou la désactiver."
    );

  const buttons = perms.ALL_PERMS.map(p =>
    new ButtonBuilder()
      .setCustomId(`cfg:perm:toggle:${userId}:${p}`)
      .setLabel(perms.PERM_LABELS[p])
      .setStyle(current.includes(p) ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(isOwnerTarget)
  );

  const components = chunk(buttons, 3).map(group => new ActionRowBuilder().addComponents(group));

  if (!isOwnerTarget && current.includes(perms.PERMS.MANAGE_MP)) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cfg:perm:mprestrict:${userId}`).setLabel('Limiter les cibles MP de ce membre').setStyle(ButtonStyle.Secondary).setEmoji('🎯')
      )
    );
  }

  components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:perm').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)));

  return { embed, components };
}

async function selectPermissionUser(interaction) {
  const userId = interaction.values[0];
  const { embed, components } = buildUserPermissionsPanel(interaction.guildId, userId, interaction.guild.ownerId);
  await interaction.update({ embeds: [embed], components });
}

async function togglePermission(interaction, userId, perm) {
  if (userId === interaction.guild.ownerId) {
    // Verrouillé : on réaffiche simplement le panneau sans rien changer.
    const { embed, components } = buildUserPermissionsPanel(interaction.guildId, userId, interaction.guild.ownerId);
    return interaction.update({ embeds: [embed], components });
  }
  const now = perms.togglePerm(interaction.guildId, userId, perm, interaction.guild.ownerId);
  logs.logFromInteraction(interaction, 'permissions.toggle', `<@${userId}> — ${perms.PERM_LABELS[perm]} ${now ? 'accordée' : 'retirée'}`);
  const { embed, components } = buildUserPermissionsPanel(interaction.guildId, userId, interaction.guild.ownerId);
  await interaction.update({ embeds: [embed], components });
}

async function showMpRestrictionsPanel(interaction, userId) {
  const restrictions = perms.getMpRestrictions(interaction.guildId, userId);
  const roles = restrictions.filter(r => r.target_type === 'role').map(r => `<@&${r.target_id}>`);
  const usersList = restrictions.filter(r => r.target_type === 'user').map(r => `<@${r.target_id}>`);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🎯 Cibles MP autorisées pour <@${userId}>`)
    .setDescription(
      "Si aucune cible n'est listée pour un type (rôle ou membre), ce membre peut cibler librement via ce type.\nDès qu'au moins une cible est ajoutée, seules les cibles listées sont autorisées.\n\n" +
        `**Rôles autorisés :** ${roles.length ? roles.join(', ') : '*aucune restriction*'}\n` +
        `**Membres autorisés :** ${usersList.length ? usersList.join(', ') : '*aucune restriction*'}`
    );

  const roleSelect = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId(`cfg:perm:mprestrict:addrole:${userId}`).setPlaceholder('➕ Autoriser un rôle').setMaxValues(1)
  );
  const userSelect = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId(`cfg:perm:mprestrict:adduser:${userId}`).setPlaceholder('➕ Autoriser un membre').setMaxValues(1)
  );
  const clear = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cfg:perm:mprestrict:clear:${userId}`).setLabel('Retirer toutes les restrictions').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`cfg:perm:select:back:${userId}`).setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({ embeds: [embed], components: [roleSelect, userSelect, clear] });
}

async function addMpRestrictionRole(interaction, userId) {
  perms.addMpRestriction(interaction.guildId, userId, 'role', interaction.values[0]);
  logs.logFromInteraction(interaction, 'permissions.mprestrict', `<@${userId}> limité au rôle <@&${interaction.values[0]}>`);
  await showMpRestrictionsPanel(interaction, userId);
}

async function addMpRestrictionUser(interaction, userId) {
  perms.addMpRestriction(interaction.guildId, userId, 'user', interaction.values[0]);
  logs.logFromInteraction(interaction, 'permissions.mprestrict', `<@${userId}> limité au membre <@${interaction.values[0]}>`);
  await showMpRestrictionsPanel(interaction, userId);
}

async function clearMpRestrictionsHandler(interaction, userId) {
  db.prepare('DELETE FROM mp_restrictions WHERE guild_id = ? AND user_id = ?').run(interaction.guildId, userId);
  logs.logFromInteraction(interaction, 'permissions.mprestrict', `<@${userId}> — restrictions MP réinitialisées`);
  await showMpRestrictionsPanel(interaction, userId);
}

async function backToUserPermissions(interaction, userId) {
  const { embed, components } = buildUserPermissionsPanel(interaction.guildId, userId, interaction.guild.ownerId);
  await interaction.update({ embeds: [embed], components });
}

/* ------------------------------------------------------------------ */
/*  MP DE BIENVENUE (dm on join)                                       */
/* ------------------------------------------------------------------ */

async function showWelcomeMpPanel(interaction) {
  const cfg = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(interaction.guildId);
  const message = cfg?.dm_on_join_message || null;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('👋 MP de bienvenue')
    .setDescription('Envoyé automatiquement à chaque nouveau membre qui rejoint le serveur.')
    .addFields(
      { name: 'Statut', value: cfg?.dm_on_join ? '✅ Activé' : '❌ Désactivé', inline: true },
      { name: 'Message actuel', value: message ? truncateField(message, 500) : '*Aucun message personnalisé défini (message par défaut utilisé)*' }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('cfg:dmjoin:toggle')
      .setLabel(cfg?.dm_on_join ? 'Désactiver' : 'Activer')
      .setStyle(cfg?.dm_on_join ? ButtonStyle.Danger : ButtonStyle.Success)
      .setEmoji(cfg?.dm_on_join ? '🔕' : '🔔'),
    new ButtonBuilder().setCustomId('cfg:dmjoin:message').setLabel('Modifier le message').setStyle(ButtonStyle.Secondary).setEmoji('✏️')
  );
  const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:back').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary));

  await interaction.update({ embeds: [embed], components: [row, back] });
}

async function toggleDmOnJoin(interaction) {
  const cfg = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(interaction.guildId);
  const newVal = cfg && cfg.dm_on_join ? 0 : 1;
  db.prepare(
    `INSERT INTO guild_config (guild_id, dm_on_join) VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET dm_on_join = excluded.dm_on_join`
  ).run(interaction.guildId, newVal);
  logs.logFromInteraction(interaction, 'config.dmjoin.toggle', newVal ? 'activé' : 'désactivé');

  await showWelcomeMpPanel(interaction);
}

async function saveDmJoinMessage(interaction) {
  const message = interaction.fields.getTextInputValue('message');
  db.prepare(
    `INSERT INTO guild_config (guild_id, dm_on_join_message) VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET dm_on_join_message = excluded.dm_on_join_message`
  ).run(interaction.guildId, message);
  logs.logFromInteraction(interaction, 'config.dmjoin.message');

  const cfg = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(interaction.guildId);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('👋 MP de bienvenue')
    .setDescription('Envoyé automatiquement à chaque nouveau membre qui rejoint le serveur.')
    .addFields(
      { name: 'Statut', value: cfg?.dm_on_join ? '✅ Activé' : '❌ Désactivé', inline: true },
      { name: 'Message actuel', value: truncateField(message, 500) }
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('cfg:dmjoin:toggle')
      .setLabel(cfg?.dm_on_join ? 'Désactiver' : 'Activer')
      .setStyle(cfg?.dm_on_join ? ButtonStyle.Danger : ButtonStyle.Success)
      .setEmoji(cfg?.dm_on_join ? '🔕' : '🔔'),
    new ButtonBuilder().setCustomId('cfg:dmjoin:message').setLabel('Modifier le message').setStyle(ButtonStyle.Secondary).setEmoji('✏️')
  );
  const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:back').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary));

  await respondPreferUpdate(interaction, { content: '✅ Message de bienvenue enregistré.', embeds: [embed], components: [row, back] });
}

/* ------------------------------------------------------------------ */
/*  COMPOSANTS ATTACHÉS AUX MP (répondre à l'enquête / supprimer)      */
/* ------------------------------------------------------------------ */

function buildDmComponents(guild, options = {}) {
  const { highlightSurveyId, disabled } = options;

  let activeSurveys;
  if (highlightSurveyId) {
    const s = db.prepare("SELECT id, name FROM surveys WHERE id = ? AND guild_id = ? AND status = 'active'").get(highlightSurveyId, guild.id);
    activeSurveys = s ? [s] : [];
  } else {
    activeSurveys = db.prepare("SELECT id, name FROM surveys WHERE guild_id = ? AND status = 'active'").all(guild.id);
  }

  const rows = [];

  if (activeSurveys.length === 1) {
    const s = activeSurveys[0];
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`resp:start:${s.id}`)
          .setLabel(`Répondre : ${s.name}`.slice(0, 80))
          .setStyle(ButtonStyle.Success)
          .setEmoji('📝')
          .setDisabled(!!disabled)
      )
    );
  } else if (activeSurveys.length > 1) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`resp:dmselect:${guild.id}`)
      .setPlaceholder('📝 Choisis une enquête à laquelle répondre')
      .setDisabled(!!disabled)
      .addOptions(activeSurveys.slice(0, 25).map(s => ({ label: s.name.slice(0, 100), value: String(s.id) })));
    rows.push(new ActionRowBuilder().addComponents(select));
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('dm:delete').setLabel('Supprimer ce message').setStyle(ButtonStyle.Secondary).setEmoji('🗑️').setDisabled(!!disabled)
    )
  );

  return rows;
}

// Construit l'embed envoyé en MP (broadcast), avec mise en avant optionnelle d'une enquête.
function buildBroadcastEmbed(substitutedMessage, highlightSurvey) {
  const embed = new EmbedBuilder().setColor(0x5865f2).setDescription(substitutedMessage.slice(0, 4000));
  if (highlightSurvey) {
    embed.setTitle(`📋 ${highlightSurvey.name}`);
    embed.setFooter({ text: describeAnonymityModes(getAnonymityModes(highlightSurvey)) });
  }
  return embed;
}

async function handleDmDelete(interaction) {
  await interaction.deferUpdate().catch(() => {});
  await interaction.message.delete().catch(() => {});
}

/* ------------------------------------------------------------------ */
/*  MESSAGES PRÉ-REMPLIS (presets) POUR LES MP                         */
/* ------------------------------------------------------------------ */

// Nettoie un texte pour l'utiliser comme description d'option de menu déroulant :
// Discord peut se comporter de façon incohérente avec des sauts de ligne dans ce
// champ (certains presets ne s'affichaient/fonctionnaient pas) -> on les retire.
function toSelectDescription(text, max = 95) {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

async function showPresetPanel(interaction, context) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('✉️ Choisis un message')
    .setDescription('Sélectionne un modèle pré-rempli (tu pourras le modifier avant envoi) ou rédige le tien.');

  const select = new StringSelectMenuBuilder()
    .setCustomId(`cfg:preset:${context}`)
    .setPlaceholder('Choisis un modèle de message')
    .addOptions([
      ...DM_PRESETS.map(p => ({ label: p.label, description: toSelectDescription(p.text), value: p.id })),
      { label: '✍️ Message personnalisé', description: 'Rédiger un message depuis zéro', value: 'custom' }
    ]);

  const backTarget = context === 'dmjoin' ? 'cfg:welcome' : 'cfg:broadcast';
  const back = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(backTarget).setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)
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
/*  MP CIBLÉ (tous / rôle / utilisateurs) — avec permissions + sécurité */
/* ------------------------------------------------------------------ */

async function showBroadcastTargetPanel(interaction) {
  const canAll = perms.hasPerm(interaction, perms.PERMS.MP_ALL);
  const canTargeted = perms.hasPerm(interaction, perms.PERMS.MANAGE_MP);
  const draft = broadcastTargets.get(interaction.user.id) || {};
  const activeSurveys = db.prepare("SELECT id, name FROM surveys WHERE guild_id = ? AND status = 'active'").all(interaction.guildId);
  const highlightSurvey = draft.highlightSurveyId ? activeSurveys.find(s => String(s.id) === String(draft.highlightSurveyId)) : null;

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('📢 Envoyer un MP')
    .setDescription(
      'Choisis les destinataires du message privé.' +
        (activeSurveys.length ? " Tu peux aussi mettre une enquête en avant ci-dessous (optionnel) avant de choisir la cible — le bouton \"Répondre\" du MP pointera alors directement vers elle." : '')
    )
    .addFields({ name: '🎯 Enquête mise en avant', value: highlightSurvey ? highlightSurvey.name : 'Aucune' });

  const rows = [];
  if (canAll) {
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:broadcast:all').setLabel('Tous les membres').setStyle(ButtonStyle.Danger).setEmoji('🌐')));
  }
  if (canTargeted) {
    rows.push(new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('cfg:broadcast:role').setPlaceholder('🎭 Cibler un rôle').setMaxValues(1)));
    rows.push(new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('cfg:broadcast:users').setPlaceholder('👤 Cibler des utilisateurs précis').setMaxValues(25)));
  }
  if (activeSurveys.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('cfg:broadcast:highlight')
      .setPlaceholder('🎯 Mettre une enquête en avant (optionnel)')
      .addOptions([
        { label: 'Aucune mise en avant', value: 'none', emoji: '🚫', default: !draft.highlightSurveyId },
        ...activeSurveys.slice(0, 24).map(s => ({ label: s.name.slice(0, 100), value: String(s.id), default: String(draft.highlightSurveyId) === String(s.id) }))
      ]);
    rows.push(new ActionRowBuilder().addComponents(select));
  }
  rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:back').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)));

  await interaction.update({ embeds: [embed], components: rows });
}

async function handleHighlightSelect(interaction) {
  const value = interaction.values[0];
  const draft = broadcastTargets.get(interaction.user.id) || {};
  draft.highlightSurveyId = value === 'none' ? null : value;
  broadcastTargets.set(interaction.user.id, draft);
  await showBroadcastTargetPanel(interaction); // reste sur le même écran, juste rafraîchi
}

async function selectBroadcastAll(interaction) {
  const draft = broadcastTargets.get(interaction.user.id) || {};
  broadcastTargets.set(interaction.user.id, { ...draft, type: 'all' });
  await showPresetPanel(interaction, 'broadcast');
}

async function selectBroadcastRole(interaction) {
  const roleId = interaction.values[0];
  const check = perms.validateMpTarget(interaction, 'role', [roleId]);
  if (!check.ok) {
    return interaction.reply({ content: `❌ Tu n'es pas autorisé à cibler ce rôle. Rôles/membres autorisés configurés par un responsable du serveur.`, flags: MessageFlags.Ephemeral });
  }
  const draft = broadcastTargets.get(interaction.user.id) || {};
  broadcastTargets.set(interaction.user.id, { ...draft, type: 'role', roleId });
  await showPresetPanel(interaction, 'broadcast');
}

async function selectBroadcastUsers(interaction) {
  const userIds = interaction.values;
  const check = perms.validateMpTarget(interaction, 'user', userIds);
  if (!check.ok) {
    return interaction.reply({
      content: `❌ Tu n'es pas autorisé à cibler ${check.notAllowed.map(id => `<@${id}>`).join(', ')}. Un responsable du serveur peut ajuster tes cibles autorisées.`,
      flags: MessageFlags.Ephemeral
    });
  }
  const draft = broadcastTargets.get(interaction.user.id) || {};
  broadcastTargets.set(interaction.user.id, { ...draft, type: 'users', userIds });
  await showPresetPanel(interaction, 'broadcast');
}

/* ---------------- Envoi effectif ---------------- */

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

// Neutralise les mentions de masse pour éviter tout usage détourné du contenu copié/relayé.
// Appliqué APRÈS substitution des variables, pour couvrir aussi un nom d'enquête piégé.
function sanitizeBroadcastMessage(message) {
  return message.replace(/@(everyone|here)/g, '@\u200b$1');
}

async function resolveRecipients(guild, target) {
  if (target.type === 'all') {
    const members = await guild.members.fetch();
    return [...members.values()].filter(m => !m.user.bot);
  }
  if (target.type === 'role') {
    await guild.members.fetch(); // s'assure que le cache des membres (et donc role.members) est rempli
    const role = await guild.roles.fetch(target.roleId).catch(() => null);
    return role ? [...role.members.values()].filter(m => !m.user.bot) : [];
  }
  if (target.type === 'users') {
    const out = [];
    for (const id of target.userIds) {
      const m = await guild.members.fetch(id).catch(() => null);
      if (m && !m.user.bot) out.push(m);
    }
    return out;
  }
  return [];
}

function buildVariableContext(interactionGuild, member, highlightSurvey) {
  return {
    username: member.user ? member.user.username : member.username,
    userId: member.id,
    surveyName: highlightSurvey?.name,
    surveyId: highlightSurvey?.id,
    surveyPrivacy: highlightSurvey ? describeAnonymityModes(getAnonymityModes(highlightSurvey)) : '',
    serverName: interactionGuild.name
  };
}

// Étape de sécurité : avant tout envoi, on montre un récapitulatif (cible, nombre de
// destinataires, aperçu du message) ET un second message éphémère avec le RENDU RÉEL
// (embed + boutons désactivés) tel qu'il apparaîtra chez un destinataire.
// Optimisation : les destinataires résolus ici sont mis en cache et réutilisés tels
// quels lors de la confirmation, pour éviter un second aller-retour identique vers
// l'API Discord (fetch complet des membres) au moment de l'envoi réel.
async function prepareBroadcast(interaction) {
  const rawMessage = interaction.fields.getTextInputValue('message');
  const target = broadcastTargets.get(interaction.user.id) || { type: 'all' };
  const highlightSurveyId = target.highlightSurveyId || null;
  const highlightSurvey = highlightSurveyId ? db.prepare('SELECT * FROM surveys WHERE id = ?').get(highlightSurveyId) : null;

  await interaction.reply({ content: '🔎 Calcul du nombre de destinataires…', flags: MessageFlags.Ephemeral });

  const recipients = await resolveRecipients(interaction.guild, target);
  broadcastDrafts.set(interaction.user.id, { target, message: rawMessage, highlightSurveyId, recipients });

  const targetLabel =
    target.type === 'all' ? 'Tous les membres' : target.type === 'role' ? `Le rôle <@&${target.roleId}>` : `${target.userIds.length} utilisateur(s) précis`;

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('⚠️ Confirmation avant envoi')
    .addFields(
      { name: 'Cible', value: targetLabel, inline: true },
      { name: 'Destinataires', value: `${recipients.length}`, inline: true },
      { name: 'Enquête mise en avant', value: highlightSurvey ? highlightSurvey.name : 'Aucune', inline: true },
      { name: 'Message (variables non substituées)', value: rawMessage.length > 500 ? rawMessage.slice(0, 500) + '…' : rawMessage }
    );

  if (recipients.length >= BIG_BROADCAST_THRESHOLD) {
    embed.addFields({ name: '⚠️ Attention', value: `Cela concerne un grand nombre de membres (${recipients.length}). Vérifie bien le message avant de confirmer.` });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfg:broadcast:confirm').setLabel(`Envoyer à ${recipients.length} membre(s)`).setStyle(ButtonStyle.Danger).setEmoji('📨'),
    new ButtonBuilder().setCustomId('cfg:broadcast:cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary)
  );

  await interaction.editReply({ content: null, embeds: [embed], components: [row] });

  // Second message éphémère : rendu WYSIWYG avec les infos de l'admin en exemple,
  // boutons visibles mais désactivés (non fonctionnels), comme demandé.
  const previewCtx = buildVariableContext(interaction.guild, interaction.user, highlightSurvey);
  const previewText = sanitizeBroadcastMessage(substituteVariables(rawMessage, previewCtx));
  const previewEmbed = buildBroadcastEmbed(previewText, highlightSurvey);
  const previewComponents = buildDmComponents(interaction.guild, { highlightSurveyId, disabled: true });

  await interaction.followUp({
    content: '👁️ **Aperçu du rendu final** (avec tes propres infos en exemple ; les boutons ci-dessous ne sont pas fonctionnels) :',
    embeds: [previewEmbed],
    components: previewComponents,
    flags: MessageFlags.Ephemeral
  });
}

async function cancelBroadcast(interaction) {
  broadcastDrafts.delete(interaction.user.id);
  broadcastTargets.delete(interaction.user.id);
  const { embed, components } = buildMainPanel(interaction);
  await interaction.update({ content: '❌ Envoi annulé.', embeds: [embed], components });
}

async function confirmBroadcast(interaction) {
  const draft = broadcastDrafts.get(interaction.user.id);
  if (!draft) {
    return interaction.update({ content: '❌ Cette confirmation a expiré, relance l\'envoi du MP.', embeds: [], components: [] });
  }
  broadcastDrafts.delete(interaction.user.id);
  broadcastTargets.delete(interaction.user.id);

  await interaction.update({ content: '📢 Envoi des MP en cours, cela peut prendre du temps…', embeds: [], components: [] });

  // Réutilise les destinataires déjà résolus lors de la confirmation (pas de second fetch).
  const recipients = draft.recipients;
  const highlightSurvey = draft.highlightSurveyId ? db.prepare('SELECT * FROM surveys WHERE id = ?').get(draft.highlightSurveyId) : null;
  let success = 0;
  let failed = 0;

  for (const member of recipients) {
    const ctx = buildVariableContext(interaction.guild, member, highlightSurvey);
    const substituted = sanitizeBroadcastMessage(substituteVariables(draft.message, ctx));
    const embed = buildBroadcastEmbed(substituted, highlightSurvey);
    const components = buildDmComponents(interaction.guild, { highlightSurveyId: draft.highlightSurveyId });

    const ok = await sendDmWithRetry(member, { embeds: [embed], components });
    if (ok) success++;
    else failed++;
    await new Promise(r => setTimeout(r, 350));
  }

  const targetLabel =
    draft.target.type === 'all' ? 'tous les membres' : draft.target.type === 'role' ? `le rôle <@&${draft.target.roleId}>` : `${draft.target.userIds.length} utilisateur(s) ciblé(s)`;

  logs.logFromInteraction(interaction, 'broadcast.sent', `${targetLabel} — ${success} envoyés, ${failed} échecs`);

  await interaction.followUp({
    content: `✅ Envoi terminé (${targetLabel}) : **${success}** MP envoyés, **${failed}** échecs (MP fermés ou bot).`,
    flags: MessageFlags.Ephemeral
  });
}


/* ------------------------------------------------------------------ */
/*  GESTION DES ENQUÊTES — menu unique (créer / voir la liste)          */
/* ------------------------------------------------------------------ */

async function showSurveyManagementPanel(interaction, page = 0, mode = 'active') {
  const guildId = interaction.guildId;
  const where = mode === 'archived' ? 'archived = 1' : mode === 'templates' ? 'is_template = 1' : 'archived = 0 AND is_template = 0';
  const all = db.prepare(`SELECT * FROM surveys WHERE guild_id = ? AND ${where} ORDER BY created_at DESC`).all(guildId);
  const archivedCount = mode === 'archived' ? all.length : db.prepare('SELECT COUNT(*) c FROM surveys WHERE guild_id = ? AND archived = 1').get(guildId).c;
  const templateCount = mode === 'templates' ? all.length : db.prepare('SELECT COUNT(*) c FROM surveys WHERE guild_id = ? AND is_template = 1').get(guildId).c;

  const titles = { active: '📋 Gestion des enquêtes', archived: '🗄️ Enquêtes archivées', templates: '📑 Modèles réutilisables' };
  const emptyTexts = {
    active: "Aucune enquête n'a encore été créée sur ce serveur.",
    archived: 'Aucune enquête archivée sur ce serveur.',
    templates: 'Aucun modèle réutilisable sur ce serveur.'
  };

  const embed = new EmbedBuilder()
    .setColor(mode === 'archived' ? 0x99aab5 : mode === 'templates' ? 0xeb459e : 0x5865f2)
    .setTitle(titles[mode])
    .setDescription(all.length ? `${all.length} enquête(s) — choisis-en une ci-dessous pour la gérer.` : emptyTexts[mode]);

  const components = [];
  if (mode === 'active') {
    components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:new_survey').setLabel('Nouvelle enquête').setStyle(ButtonStyle.Success).setEmoji('🆕')));
  }

  if (all.length) {
    const totalPages = Math.max(1, Math.ceil(all.length / SURVEYS_PER_PAGE));
    page = Math.max(0, Math.min(page, totalPages - 1));
    const pageItems = all.slice(page * SURVEYS_PER_PAGE, page * SURVEYS_PER_PAGE + SURVEYS_PER_PAGE);

    const statusEmoji = { draft: '📝', active: '🟢', closed: '🔴' };
    const modeTag = { active: null, archived: '🗄️ archivée', templates: '📑 modèle' };
    const select = new StringSelectMenuBuilder()
      .setCustomId('cfg:survey:select')
      .setPlaceholder('Choisis une enquête à gérer')
      .addOptions(pageItems.map(s => ({ label: s.name.slice(0, 100), description: modeTag[mode] || `${statusEmoji[s.status] || ''} ${s.status}`, value: String(s.id) })));
    components.push(new ActionRowBuilder().addComponents(select));

    if (totalPages > 1) {
      const modeArg = mode === 'archived' ? '1' : mode === 'templates' ? '2' : '0';
      components.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`cfg:survey:list:${page - 1}:${modeArg}`).setLabel('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
          new ButtonBuilder().setCustomId(`cfg:survey:list:${page + 1}:${modeArg}`).setLabel('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1)
        )
      );
      embed.setFooter({ text: `Page ${page + 1}/${totalPages} • ${all.length} enquête(s)` });
    }
  }

  const navButtons = [];
  if (mode === 'active') {
    navButtons.push(new ButtonBuilder().setCustomId('cfg:surveys:archived').setLabel(`🗄️ Archivées (${archivedCount})`).setStyle(ButtonStyle.Secondary).setDisabled(!archivedCount));
    navButtons.push(new ButtonBuilder().setCustomId('cfg:surveys:templates').setLabel(`📑 Modèles (${templateCount})`).setStyle(ButtonStyle.Secondary).setDisabled(!templateCount));
  } else {
    navButtons.push(new ButtonBuilder().setCustomId('cfg:surveys').setLabel('⬅️ Enquêtes actives').setStyle(ButtonStyle.Secondary));
  }
  navButtons.push(new ButtonBuilder().setCustomId('cfg:back').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary));
  components.push(new ActionRowBuilder().addComponents(navButtons));

  await interaction.update({ embeds: [embed], components });
}

/* ------------------------------------------------------------------ */
/*  CRÉATION D'ENQUÊTE — avec modèles (presets)                        */
/* ------------------------------------------------------------------ */

async function showTemplateChoicePanel(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🆕 Nouvelle enquête')
    .setDescription("Pars d'un modèle pré-rempli (modifiable ensuite) ou crée une enquête vierge.");

  const buttons = Object.entries(SURVEY_TEMPLATES).map(([id, t]) =>
    new ButtonBuilder().setCustomId(`cfg:new_survey:tmpl:${id}`).setLabel(t.label).setStyle(id === 'blank' ? ButtonStyle.Secondary : ButtonStyle.Primary).setEmoji(t.emoji)
  );
  const rows = chunk(buttons, 3).map(g => new ActionRowBuilder().addComponents(g));
  rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:surveys').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)));

  await interaction.update({ embeds: [embed], components: rows });
}

async function showNewSurveyModalForTemplate(interaction, templateId) {
  const tmpl = SURVEY_TEMPLATES[templateId] || SURVEY_TEMPLATES.blank;
  const modal = new ModalBuilder().setCustomId(`cfg:new_survey:modal:${templateId}`).setTitle('Nouvelle enquête');
  const name = new TextInputBuilder().setCustomId('name').setLabel("Nom de l'enquête").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(tmpl.name);
  const description = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Description (affichée aux membres)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500)
    .setValue(tmpl.description);
  const maxResponses = new TextInputBuilder()
    .setCustomId('max')
    .setLabel('Réponses max par utilisateur (0 = illimité)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setValue(tmpl.max);
  const closeAt = new TextInputBuilder().setCustomId('closeat').setLabel('Clôture auto JJ/MM/AAAA HH:MM (vide = non)').setStyle(TextInputStyle.Short).setRequired(false);
  modal.addComponents(
    new ActionRowBuilder().addComponents(name),
    new ActionRowBuilder().addComponents(description),
    new ActionRowBuilder().addComponents(maxResponses),
    new ActionRowBuilder().addComponents(closeAt)
  );
  await interaction.showModal(modal);
}

async function createSurvey(interaction, templateId) {
  const name = interaction.fields.getTextInputValue('name').trim();
  const description = interaction.fields.getTextInputValue('description')?.trim() || null;
  const maxRaw = interaction.fields.getTextInputValue('max')?.trim();
  const max = Number.isFinite(parseInt(maxRaw, 10)) ? parseInt(maxRaw, 10) : 1;
  const closeAtRaw = interaction.fields.getTextInputValue('closeat')?.trim();
  const closeAt = closeAtRaw ? parseDateTimeFR(closeAtRaw) : null;

  const info = db
    .prepare(
      `INSERT INTO surveys (guild_id, name, description, max_responses_per_user, status, anonymity_modes, close_at, created_by, created_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
    )
    .run(interaction.guildId, name, description, max, JSON.stringify(['semi']), closeAt, interaction.user.id, Date.now());

  const surveyId = info.lastInsertRowid;

  const tmpl = SURVEY_TEMPLATES[templateId];
  if (tmpl && tmpl.questions.length) {
    const insertQ = db.prepare('INSERT INTO questions (survey_id, position, label, type, options, required) VALUES (?, ?, ?, ?, ?, ?)');
    tmpl.questions.forEach((q, i) => {
      insertQ.run(surveyId, i, q.label, q.type, q.options ? JSON.stringify(q.options) : null, q.required);
    });
  }

  logs.logFromInteraction(interaction, 'survey.create', `${name}${tmpl ? ` (modèle : ${tmpl.label})` : ''}`);

  const warning = closeAtRaw && !closeAt ? '⚠️ Date de clôture invalide, ignorée (format attendu JJ/MM/AAAA HH:MM). ' : '';
  await respondPreferUpdate(interaction, buildAnonymityStepPayload(surveyId, warning));
}

const PRIVACY_OPTION_EMOJI = { public: '🌐', semi: '🛡️', private: '🙈' };
const PRIVACY_OPTION_LABEL = { public: 'Publique', semi: 'Semi-privé', private: 'Privé' };

// Un seul <select> à choix multiple (1 à 3 parmi Publique/Semi-privé/Privé).
// 1 seul coché = comportement figé. Plusieurs = chaque membre choisit parmi
// exactement ceux-là en répondant.
function buildPrivacyModeSelect(surveyId, selectedModes = ['semi']) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`survey:anonmode:${surveyId}`)
    .setPlaceholder('Choisis un ou plusieurs modes')
    .setMinValues(1)
    .setMaxValues(3)
    .addOptions(
      ['public', 'semi', 'private'].map(m => ({
        label: PRIVACY_OPTION_LABEL[m],
        value: m,
        emoji: PRIVACY_OPTION_EMOJI[m],
        default: selectedModes.includes(m)
      }))
    );
  return new ActionRowBuilder().addComponents(select);
}

function buildAnonymityStepPayload(surveyId, prefix = '', selectedModes = ['semi']) {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('🔒 Confidentialité des réponses')
    .setDescription(
      `${prefix}Choisis un ou plusieurs modes de confidentialité pour cette enquête :\n\n` +
        '🌐 **Publique** — le nom du répondant est affiché dans les stats\n' +
        '🛡️ **Semi-privé** — le nom n\'est visible que du staff (sert aussi à limiter les doublons)\n' +
        '🙈 **Privé** — aucun nom conservé, réponses illimitées par personne\n\n' +
        'Si tu en coches **plusieurs**, chaque membre choisira son mode préféré parmi ceux-là en répondant.'
    );

  return { embeds: [embed], components: [buildPrivacyModeSelect(surveyId, selectedModes)] };
}

// Utilisé à la création ET pour modifier la confidentialité depuis le builder/dashboard.
// interaction.values = tableau de 1 à 3 modes choisis dans le <select>.
async function handleAnonymityModeChoice(interaction, surveyId) {
  const modes = interaction.values;
  const primary = modes.length === 1 ? modes[0] : 'choice'; // conservé pour affichage/compat
  // Dès que "Privé" est l'une des options proposées, la limite de réponses par
  // utilisateur ne peut plus être garantie pour tout le monde (un membre peut
  // toujours choisir Privé pour la contourner) : on la force à illimité.
  if (modes.includes('private')) {
    db.prepare('UPDATE surveys SET anonymity_modes = ?, anonymity_mode = ?, max_responses_per_user = 0 WHERE id = ?').run(JSON.stringify(modes), primary, surveyId);
  } else {
    db.prepare('UPDATE surveys SET anonymity_modes = ?, anonymity_mode = ? WHERE id = ?').run(JSON.stringify(modes), primary, surveyId);
  }
  logs.logFromInteraction(interaction, 'survey.edit', `confidentialité = ${modes.join(' + ')}`);

  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  if (survey.status === 'draft') {
    const { embed, components } = buildSurveyBuilderPanel(surveyId);
    await interaction.update({ embeds: [embed], components });
  } else {
    const { embed, components } = buildDashboard(surveyId);
    await interaction.update({ embeds: [embed], components });
  }
}

async function showAnonymityChooserButton(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const current = getAnonymityModes(survey);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🔒 Confidentialité des réponses')
    .setDescription(
      "Choisis un ou plusieurs modes de confidentialité pour cette enquête :\n\n" +
        '🌐 **Publique** — nom affiché dans les stats\n' +
        '🛡️ **Semi-privé** — nom visible du staff uniquement\n' +
        '🙈 **Privé** — aucun nom conservé, réponses illimitées\n\n' +
        'Plusieurs modes cochés = chaque membre choisit parmi ceux-là en répondant.\n\n' +
        "⚠️ Activer **Privé** réinitialisera la limite de réponses par utilisateur à illimité."
    );
  await interaction.update({ embeds: [embed], components: [buildPrivacyModeSelect(surveyId, current)] });
}

const TYPE_EMOJI = { texte: '📝', nombre: '🔢', choix: '🔘' };

function formatQuestionLine(q, i) {
  const emoji = TYPE_EMOJI[q.type] || '❓';
  const requiredBadge = q.required ? '🔴 Obligatoire' : '⚪ Optionnelle';
  let line = `**${i + 1}.** ${emoji} ${q.label}\n\u2003${requiredBadge} • ${describeQuestionSettings(q)}`;
  if (q.type === 'choix') {
    line += `\n\u2003Options : ${JSON.parse(q.options || '[]').join(', ')}`;
  }
  return line;
}

function buildSurveyBuilderPanel(surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const questions = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position ASC').all(surveyId);

  const qList = truncateField(questions.length ? questions.map((q, i) => formatQuestionLine(q, i)).join('\n\n') : '*Aucune question pour le moment.*');

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`🛠️ Construction : ${survey.is_template ? '📑 [Modèle] ' : ''}${survey.name}`)
    .setDescription(
      (survey.is_template ? "📑 **Ceci est un modèle réutilisable** : il ne peut pas être publié tel quel. Duplique-le pour créer une vraie enquête à partir de ce modèle.\n\n" : '') +
        (survey.description || '*Pas de description*')
    )
    .addFields(
      { name: `Questions (${questions.length})`, value: qList },
      { name: 'Réponses max / utilisateur', value: survey.max_responses_per_user === 0 ? 'Illimité' : String(survey.max_responses_per_user), inline: true },
      { name: 'Confidentialité', value: describeAnonymityModes(getAnonymityModes(survey)), inline: true },
      { name: 'Clôture auto', value: survey.close_at ? `<t:${Math.floor(survey.close_at / 1000)}:f>` : 'Aucune', inline: true }
    );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:addq:${surveyId}`).setLabel('Ajouter une question').setStyle(ButtonStyle.Primary).setEmoji('➕'),
    new ButtonBuilder().setCustomId(`survey:preview:${surveyId}`).setLabel('Aperçu interactif').setStyle(ButtonStyle.Secondary).setEmoji('👁️').setDisabled(questions.length === 0)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:editmeta:${surveyId}`).setLabel('Modifier').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
    new ButtonBuilder().setCustomId(`survey:anonedit:${surveyId}`).setLabel('Anonymat').setStyle(ButtonStyle.Secondary).setEmoji('🎭'),
    new ButtonBuilder().setCustomId(`survey:closeat:${surveyId}`).setLabel('Clôture').setStyle(ButtonStyle.Secondary).setEmoji('📅')
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`survey:publish:${surveyId}`)
      .setLabel('Publier')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🚀')
      .setDisabled(questions.length === 0 || !!survey.is_template),
    new ButtonBuilder()
      .setCustomId(`survey:template:toggle:${surveyId}`)
      .setLabel(survey.is_template ? 'Retirer du statut modèle' : 'Marquer comme modèle')
      .setStyle(survey.is_template ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setEmoji('📑')
  );
  if (survey.is_template) {
    row3.addComponents(new ButtonBuilder().setCustomId(`survey:duplicate:${surveyId}`).setLabel('Dupliquer en nouvelle enquête').setStyle(ButtonStyle.Success).setEmoji('🆕'));
  }

  const components = [row1, row2, row3];

  if (questions.length) {
    const manageSelect = new StringSelectMenuBuilder()
      .setCustomId(`survey:manageq:${surveyId}`)
      .setPlaceholder('🛠️ Gérer une question (modifier / réordonner / supprimer)')
      .addOptions(questions.slice(0, 25).map((q, i) => ({ label: `${i + 1}. ${q.label}`.slice(0, 100), description: `${TYPE_EMOJI[q.type] || ''} ${describeQuestionSettings(q)}`.slice(0, 100), value: String(q.id) })));
    components.push(new ActionRowBuilder().addComponents(manageSelect));
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`survey:cancel:${surveyId}`).setLabel('Supprimer cette enquête').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cfg:surveys').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)
    )
  );

  return { embed, components };
}

/* --------------------- Modifier nom / description / max -------------- */

async function showEditMetaModal(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const modal = new ModalBuilder().setCustomId(`survey:editmeta:modal:${surveyId}`).setTitle('Modifier l\'enquête');
  const name = new TextInputBuilder().setCustomId('name').setLabel("Nom de l'enquête").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(survey.name);
  const description = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Description')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500)
    .setValue(survey.description || '');
  const max = new TextInputBuilder()
    .setCustomId('max')
    .setLabel('Réponses max par utilisateur (0 = illimité)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setValue(String(survey.max_responses_per_user));
  modal.addComponents(new ActionRowBuilder().addComponents(name), new ActionRowBuilder().addComponents(description), new ActionRowBuilder().addComponents(max));
  await interaction.showModal(modal);
}

async function saveEditMeta(interaction, surveyId) {
  const name = interaction.fields.getTextInputValue('name').trim();
  const description = interaction.fields.getTextInputValue('description')?.trim() || null;
  const maxRaw = interaction.fields.getTextInputValue('max')?.trim();
  const max = Number.isFinite(parseInt(maxRaw, 10)) ? parseInt(maxRaw, 10) : 1;

  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  db.prepare('UPDATE surveys SET name = ?, description = ?, max_responses_per_user = ? WHERE id = ?').run(name, description, max, surveyId);
  logs.logFromInteraction(interaction, 'survey.edit', `${survey.name} → ${name}`);

  const updated = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  if (updated.status !== 'draft') await messages.updatePublicMessageStats(interaction.client, updated);

  if (survey.status === 'draft') {
    const { embed, components } = buildSurveyBuilderPanel(surveyId);
    await respondPreferUpdate(interaction, { content: '✅ Enquête modifiée.', embeds: [embed], components });
  } else {
    const { embed, components } = buildDashboard(surveyId);
    await respondPreferUpdate(interaction, { content: '✅ Enquête modifiée.', embeds: [embed], components });
  }
}

/* --------------------- Aperçu avant publication ---------------------- */

// Lance un vrai flux de réponse interactif, mais marqué "aperçu" : les réponses
// ne sont jamais enregistrées en base. Le mode aperçu est indiqué au début et
// rappelé à la toute fin, comme demandé.
async function previewSurvey(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const questions = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position ASC').all(surveyId);

  if (!questions.length) {
    return interaction.reply({ content: '❌ Ajoute au moins une question avant de prévisualiser.', flags: MessageFlags.Ephemeral });
  }

  await flow.startResponseFlow(interaction, survey, true);
}

/* --------------------- Clôture programmée ---------------------- */

async function showCloseAtModal(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const current = survey.close_at ? new Date(survey.close_at) : null;
  const currentStr = current
    ? `${String(current.getDate()).padStart(2, '0')}/${String(current.getMonth() + 1).padStart(2, '0')}/${current.getFullYear()} ${String(current.getHours()).padStart(2, '0')}:${String(current.getMinutes()).padStart(2, '0')}`
    : '';

  const modal = new ModalBuilder().setCustomId(`survey:closeat:modal:${surveyId}`).setTitle('Clôture automatique');
  const input = new TextInputBuilder().setCustomId('closeat').setLabel('Date JJ/MM/AAAA HH:MM (vide = désactiver)').setStyle(TextInputStyle.Short).setRequired(false).setValue(currentStr);
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
      return interaction.reply({ content: '❌ Format invalide. Utilise JJ/MM/AAAA HH:MM (ex : 25/12/2026 18:00).', flags: MessageFlags.Ephemeral });
    }
  }

  db.prepare('UPDATE surveys SET close_at = ? WHERE id = ?').run(closeAt, surveyId);
  logs.logFromInteraction(interaction, 'survey.edit', `clôture programmée pour « ${survey.name} »`);

  const updated = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  if (updated.status !== 'draft') await messages.updatePublicMessageStats(interaction.client, updated);

  if (survey.status === 'draft') {
    const { embed, components } = buildSurveyBuilderPanel(surveyId);
    await respondPreferUpdate(interaction, { content: '✅ Clôture mise à jour.', embeds: [embed], components });
  } else {
    const { embed, components } = buildDashboard(surveyId);
    await respondPreferUpdate(interaction, { content: '✅ Clôture mise à jour.', embeds: [embed], components });
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
  if (!q) return interaction.reply({ content: '❌ Question introuvable.', flags: MessageFlags.Ephemeral });

  questionDrafts.set(draftKey(interaction.user.id, surveyId), {
    mode: 'edit',
    questionId,
    label: q.label,
    options: q.options ? JSON.parse(q.options) : [],
    multiline: q.multiline,
    min_value: q.min_value,
    max_value: q.max_value,
    min_select: q.min_select,
    max_select: q.max_select
  });
  await showTypeStep(interaction, surveyId);
}

async function showTypeStep(interaction, surveyId) {
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('❓ Type de question').setDescription('Quel type de réponse les membres devront-ils donner ?');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:qtype:${surveyId}:texte`).setLabel('Texte libre').setStyle(ButtonStyle.Primary).setEmoji('📝'),
    new ButtonBuilder().setCustomId(`survey:qtype:${surveyId}:nombre`).setLabel('Nombre').setStyle(ButtonStyle.Primary).setEmoji('🔢'),
    new ButtonBuilder().setCustomId(`survey:qtype:${surveyId}:choix`).setLabel('Choix multiple').setStyle(ButtonStyle.Primary).setEmoji('🔘')
  );
  const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`survey:builder:${surveyId}`).setLabel('⬅️ Annuler').setStyle(ButtonStyle.Secondary));

  await interaction.update({ embeds: [embed], components: [row, back] });
}

async function handleTypeChoice(interaction, surveyId, type) {
  const draft = questionDrafts.get(draftKey(interaction.user.id, surveyId));
  if (!draft) return interaction.reply({ content: '❌ Session expirée, relance la création de la question.', flags: MessageFlags.Ephemeral });
  draft.type = type;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('❓ Question obligatoire ?')
    .setDescription(`Type sélectionné : **${TYPE_LABELS[type]}**\n\nCette question doit-elle obligatoirement recevoir une réponse ?`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:qreq:${surveyId}:oui`).setLabel('Oui, obligatoire').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`survey:qreq:${surveyId}:non`).setLabel('Non, optionnelle').setStyle(ButtonStyle.Secondary)
  );
  const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`survey:builder:${surveyId}`).setLabel('⬅️ Annuler').setStyle(ButtonStyle.Secondary));

  await interaction.update({ embeds: [embed], components: [row, back] });
}

// Pour le type "texte", une étape supplémentaire propose une ligne ou plusieurs.
// Pour "nombre"/"choix", on passe directement au modal final (bornes/sélections
// gérées comme de simples champs texte du modal).
async function handleRequiredChoice(interaction, surveyId, requiredValue) {
  const draft = questionDrafts.get(draftKey(interaction.user.id, surveyId));
  if (!draft) return interaction.reply({ content: '❌ Session expirée, relance la création de la question.', flags: MessageFlags.Ephemeral });
  draft.required = requiredValue === 'oui' ? 1 : 0;

  if (draft.type === 'texte') {
    return showFormatStep(interaction, surveyId);
  }
  return showFinalQuestionModal(interaction, surveyId, draft);
}

async function showFormatStep(interaction, surveyId) {
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('📝 Format de la réponse').setDescription('La réponse tiendra-t-elle sur une seule ligne, ou peut-elle être plus longue ?');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:qformat:${surveyId}:single`).setLabel('Une seule ligne').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`survey:qformat:${surveyId}:multi`).setLabel('Plusieurs lignes').setStyle(ButtonStyle.Primary)
  );
  const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`survey:builder:${surveyId}`).setLabel('⬅️ Annuler').setStyle(ButtonStyle.Secondary));

  await interaction.update({ embeds: [embed], components: [row, back] });
}

async function handleFormatChoice(interaction, surveyId, value) {
  const draft = questionDrafts.get(draftKey(interaction.user.id, surveyId));
  if (!draft) return interaction.reply({ content: '❌ Session expirée, relance la création de la question.', flags: MessageFlags.Ephemeral });
  draft.multiline = value === 'multi' ? 1 : 0;
  await showFinalQuestionModal(interaction, surveyId, draft);
}

async function showFinalQuestionModal(interaction, surveyId, draft) {
  const isEdit = draft.mode === 'edit';
  const modal = new ModalBuilder()
    .setCustomId(isEdit ? `survey:editq:modal:${surveyId}` : `survey:addq:modal:${surveyId}`)
    .setTitle(isEdit ? 'Modifier la question' : `Nouvelle question — ${TYPE_LABELS[draft.type]}`);

  const label = new TextInputBuilder().setCustomId('label').setLabel('Intitulé de la question').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300).setValue(draft.label || '');
  const rows = [new ActionRowBuilder().addComponents(label)];

  if (draft.type === 'choix') {
    const options = new TextInputBuilder()
      .setCustomId('options')
      .setLabel('Options (séparées par des virgules)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(500)
      .setValue((draft.options || []).join(', '));
    const minSelect = new TextInputBuilder()
      .setCustomId('min_select')
      .setLabel('Sélections minimum (défaut 1)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(draft.min_select ? String(draft.min_select) : '1');
    const maxSelect = new TextInputBuilder()
      .setCustomId('max_select')
      .setLabel('Sélections maximum (défaut 1)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(draft.max_select ? String(draft.max_select) : '1');
    rows.push(new ActionRowBuilder().addComponents(options), new ActionRowBuilder().addComponents(minSelect), new ActionRowBuilder().addComponents(maxSelect));
  } else if (draft.type === 'nombre') {
    const min = new TextInputBuilder()
      .setCustomId('min')
      .setLabel('Valeur minimum autorisée (vide = illimité)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(draft.min_value !== null && draft.min_value !== undefined ? String(draft.min_value) : '');
    const max = new TextInputBuilder()
      .setCustomId('max')
      .setLabel('Valeur maximum autorisée (vide = illimité)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(draft.max_value !== null && draft.max_value !== undefined ? String(draft.max_value) : '');
    rows.push(new ActionRowBuilder().addComponents(min), new ActionRowBuilder().addComponents(max));
  }

  modal.addComponents(...rows);
  await interaction.showModal(modal);
}

// Lit et valide les champs spécifiques au type (options/bornes) depuis un modal soumis.
// Retourne { ok:false, message } en cas d'erreur, ou { ok:true, ...champs } sinon.
function parseTypeSpecificFields(interaction, draft) {
  if (draft.type === 'choix') {
    const raw = interaction.fields.getTextInputValue('options') || '';
    const opts = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 25);
    if (opts.length < 2) {
      return { ok: false, message: '❌ Une question de type "choix" doit avoir au moins 2 options séparées par des virgules.' };
    }
    const minRaw = interaction.fields.getTextInputValue('min_select')?.trim();
    const maxRaw = interaction.fields.getTextInputValue('max_select')?.trim();
    let minSelect = minRaw && Number.isFinite(parseInt(minRaw, 10)) ? parseInt(minRaw, 10) : 1;
    let maxSelect = maxRaw && Number.isFinite(parseInt(maxRaw, 10)) ? parseInt(maxRaw, 10) : 1;
    minSelect = Math.max(1, Math.min(minSelect, opts.length));
    maxSelect = Math.max(minSelect, Math.min(maxSelect, opts.length));
    return { ok: true, optionsJson: JSON.stringify(opts), minSelect, maxSelect, multiline: null, minValue: null, maxValue: null };
  }

  if (draft.type === 'nombre') {
    const minRaw = interaction.fields.getTextInputValue('min')?.trim();
    const maxRaw = interaction.fields.getTextInputValue('max')?.trim();
    const minValue = minRaw && !Number.isNaN(Number(minRaw)) ? Number(minRaw) : null;
    const maxValue = maxRaw && !Number.isNaN(Number(maxRaw)) ? Number(maxRaw) : null;
    if (minValue !== null && maxValue !== null && minValue > maxValue) {
      return { ok: false, message: '❌ La valeur minimum doit être inférieure ou égale à la valeur maximum.' };
    }
    return { ok: true, optionsJson: null, minSelect: 1, maxSelect: 1, multiline: null, minValue, maxValue };
  }

  // texte
  return { ok: true, optionsJson: null, minSelect: 1, maxSelect: 1, multiline: draft.multiline ?? 1, minValue: null, maxValue: null };
}

async function addQuestion(interaction, surveyId) {
  const key = draftKey(interaction.user.id, surveyId);
  const draft = questionDrafts.get(key);
  if (!draft) return interaction.reply({ content: '❌ Session expirée, relance la création de la question.', flags: MessageFlags.Ephemeral });

  const label = interaction.fields.getTextInputValue('label').trim();
  const parsed = parseTypeSpecificFields(interaction, draft);
  if (!parsed.ok) return interaction.reply({ content: parsed.message, flags: MessageFlags.Ephemeral });

  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM questions WHERE survey_id = ?').get(surveyId).p;
  db.prepare(
    'INSERT INTO questions (survey_id, position, label, type, options, required, multiline, min_value, max_value, min_select, max_select) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(surveyId, pos, label, draft.type, parsed.optionsJson, draft.required, parsed.multiline, parsed.minValue, parsed.maxValue, parsed.minSelect, parsed.maxSelect);

  logs.logFromInteraction(interaction, 'question.add', label);
  questionDrafts.delete(key);

  const { embed, components } = buildSurveyBuilderPanel(surveyId);
  await respondPreferUpdate(interaction, { content: '✅ Question ajoutée.', embeds: [embed], components });
}

async function editQuestion(interaction, surveyId) {
  const key = draftKey(interaction.user.id, surveyId);
  const draft = questionDrafts.get(key);
  if (!draft || draft.mode !== 'edit') {
    return interaction.reply({ content: '❌ Session expirée, relance la modification.', flags: MessageFlags.Ephemeral });
  }

  const label = interaction.fields.getTextInputValue('label').trim();
  const parsed = parseTypeSpecificFields(interaction, draft);
  if (!parsed.ok) return interaction.reply({ content: parsed.message, flags: MessageFlags.Ephemeral });

  db.prepare(
    'UPDATE questions SET label = ?, type = ?, options = ?, required = ?, multiline = ?, min_value = ?, max_value = ?, min_select = ?, max_select = ? WHERE id = ?'
  ).run(label, draft.type, parsed.optionsJson, draft.required, parsed.multiline, parsed.minValue, parsed.maxValue, parsed.minSelect, parsed.maxSelect, draft.questionId);

  logs.logFromInteraction(interaction, 'question.edit', label);
  questionDrafts.delete(key);

  const { embed, components } = buildSurveyBuilderPanel(surveyId);
  await respondPreferUpdate(interaction, { content: '✅ Question modifiée.', embeds: [embed], components });
}

/* --------------------- Menu "Gérer une question" --------------------- */

async function manageQuestionSelect(interaction, surveyId) {
  const questionId = interaction.values[0];
  await showQuestionManagePanel(interaction, surveyId, questionId);
}

function describeQuestionSettings(q) {
  if (q.type === 'texte') return q.multiline ? 'Plusieurs lignes' : 'Une seule ligne';
  if (q.type === 'nombre') {
    const min = q.min_value !== null && q.min_value !== undefined ? q.min_value : '−∞';
    const max = q.max_value !== null && q.max_value !== undefined ? q.max_value : '+∞';
    return `Entre ${min} et ${max}`;
  }
  if (q.type === 'choix') {
    if (q.min_select === q.max_select) return `Choisir exactement ${q.min_select} option(s)`;
    return `Choisir entre ${q.min_select} et ${q.max_select} option(s)`;
  }
  return '';
}

async function showQuestionManagePanel(interaction, surveyId, questionId) {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId);
  if (!q) return interaction.update({ content: '❌ Question introuvable.', embeds: [], components: [] });

  const allQuestions = db.prepare('SELECT id FROM questions WHERE survey_id = ? ORDER BY position ASC').all(surveyId);
  const currentIndex = allQuestions.findIndex(r => r.id === q.id);
  const isFirst = currentIndex <= 0;
  const isLast = currentIndex === -1 || currentIndex >= allQuestions.length - 1;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🛠️ Gérer la question (${currentIndex + 1}/${allQuestions.length})`)
    .addFields(
      { name: 'Intitulé', value: q.label },
      { name: 'Type', value: TYPE_LABELS[q.type] || q.type, inline: true },
      { name: 'Obligatoire', value: q.required ? '🔴 Oui' : '⚪ Non', inline: true },
      { name: 'Réglages', value: describeQuestionSettings(q), inline: true }
    );
  if (q.type === 'choix') {
    embed.addFields({ name: 'Options', value: truncateField(JSON.parse(q.options || '[]').join(', ')) || '*aucune*' });
  }

  const eligibleConditionSources = db.prepare("SELECT COUNT(*) c FROM questions WHERE survey_id = ? AND type = 'choix' AND position < ?").get(surveyId, q.position).c;
  if (q.condition_question_id) {
    const srcQ = db.prepare('SELECT label FROM questions WHERE id = ?').get(q.condition_question_id);
    embed.addFields({ name: '🔀 Condition d\'affichage', value: srcQ ? `Affichée seulement si « ${srcQ.label} » = **${q.condition_value}**` : '*question source supprimée — condition invalide*' });
  }

  const moveRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:moveq:${surveyId}:${questionId}:up`).setLabel('Monter').setStyle(ButtonStyle.Secondary).setEmoji('⬆️').setDisabled(isFirst),
    new ButtonBuilder().setCustomId(`survey:moveq:${surveyId}:${questionId}:down`).setLabel('Descendre').setStyle(ButtonStyle.Secondary).setEmoji('⬇️').setDisabled(isLast)
  );
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:editq:${surveyId}:${questionId}`).setLabel('Modifier').setStyle(ButtonStyle.Primary).setEmoji('✏️'),
    new ButtonBuilder().setCustomId(`survey:delq2:${surveyId}:${questionId}`).setLabel('Supprimer').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
    new ButtonBuilder()
      .setCustomId(`survey:condq:${surveyId}:${questionId}`)
      .setLabel('Condition')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔀')
      .setDisabled(!eligibleConditionSources && !q.condition_question_id)
  );
  const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`survey:builder:${surveyId}`).setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary));

  await interaction.update({ embeds: [embed], components: [moveRow, actionRow, back] });
}

/* ------------------- Questions conditionnelles (logique de saut) ------------------- */

async function showConditionPicker(interaction, surveyId, questionId) {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId);
  const eligible = db.prepare("SELECT * FROM questions WHERE survey_id = ? AND type = 'choix' AND position < ? ORDER BY position ASC").all(surveyId, q.position);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🔀 Condition d\'affichage')
    .setDescription(
      `Choisis la question (à choix) dont dépend l'affichage de « ${q.label} ».\n` +
        "Cette question ne sera posée au membre que s'il a choisi la bonne réponse à la question source."
    );

  const components = [];
  if (eligible.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`survey:condq:pick:${surveyId}:${questionId}`)
      .setPlaceholder('Question source')
      .addOptions(eligible.slice(0, 25).map(eq => ({ label: eq.label.slice(0, 100), value: String(eq.id), default: eq.id === q.condition_question_id })));
    components.push(new ActionRowBuilder().addComponents(select));
  } else {
    embed.addFields({ name: 'ℹ️', value: 'Aucune question à choix ne précède celle-ci.' });
  }
  if (q.condition_question_id) {
    components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`survey:condq:clear:${surveyId}:${questionId}`).setLabel('Retirer la condition actuelle').setStyle(ButtonStyle.Danger)));
  }
  components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`survey:qmanage:${surveyId}:${questionId}`).setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)));

  await interaction.update({ embeds: [embed], components });
}

async function pickConditionSourceQuestion(interaction, surveyId, questionId) {
  const sourceId = interaction.values[0];
  const source = db.prepare('SELECT * FROM questions WHERE id = ?').get(sourceId);
  const options = JSON.parse(source.options || '[]');

  if (!options.length) {
    return interaction.reply({ content: "❌ Cette question source n'a aucune option définie.", flags: MessageFlags.Ephemeral });
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🔀 Condition d\'affichage')
    .setDescription(`Quelle réponse à « ${source.label} » doit déclencher l'affichage de cette question ?`);

  const select = new StringSelectMenuBuilder()
    .setCustomId(`survey:condq:value:${surveyId}:${questionId}:${sourceId}`)
    .setPlaceholder('Valeur déclenchante')
    .addOptions(options.slice(0, 25).map(opt => ({ label: String(opt).slice(0, 100), value: String(opt) })));

  const back = new ButtonBuilder().setCustomId(`survey:condq:${surveyId}:${questionId}`).setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary);
  await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(back)] });
}

async function setConditionValue(interaction, surveyId, questionId, sourceId) {
  const value = interaction.values[0];
  db.prepare('UPDATE questions SET condition_question_id = ?, condition_value = ? WHERE id = ?').run(sourceId, value, questionId);
  logs.logFromInteraction(interaction, 'survey.edit', `condition ajoutée sur une question`);
  await showQuestionManagePanel(interaction, surveyId, questionId);
}

async function clearCondition(interaction, surveyId, questionId) {
  db.prepare('UPDATE questions SET condition_question_id = NULL, condition_value = NULL WHERE id = ?').run(questionId);
  logs.logFromInteraction(interaction, 'survey.edit', `condition retirée d'une question`);
  await showQuestionManagePanel(interaction, surveyId, questionId);
}

// Échange la position de la question avec sa voisine immédiate (haut/bas).
async function moveQuestion(interaction, surveyId, questionId, direction) {
  const questions = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position ASC').all(surveyId);
  const index = questions.findIndex(q => String(q.id) === String(questionId));
  if (index === -1) return interaction.update({ content: '❌ Question introuvable.', embeds: [], components: [] });

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= questions.length) {
    return showQuestionManagePanel(interaction, surveyId, questionId);
  }

  const current = questions[index];
  const target = questions[targetIndex];
  db.prepare('UPDATE questions SET position = ? WHERE id = ?').run(target.position, current.id);
  db.prepare('UPDATE questions SET position = ? WHERE id = ?').run(current.position, target.id);

  logs.logFromInteraction(interaction, 'question.edit', `réorganisation : ${current.label}`);
  await showQuestionManagePanel(interaction, surveyId, questionId);
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

  const { embed, components } = buildMainPanel(interaction);
  await interaction.update({ content: '🗑️ Enquête supprimée.', embeds: [embed], components });
}

async function publishSurvey(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const cfg = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(interaction.guildId);

  if (!cfg?.response_channel_id) {
    return interaction.reply({ content: '❌ Configure d\'abord un salon de réponses (bouton "Salon des réponses" dans le panneau principal).', flags: MessageFlags.Ephemeral });
  }

  const channel = await interaction.guild.channels.fetch(cfg.response_channel_id).catch(() => null);
  if (!channel) {
    return interaction.reply({ content: '❌ Le salon configuré est introuvable. Reconfigure-le.', flags: MessageFlags.Ephemeral });
  }

  // Vérification proactive des permissions du bot dans le salon, pour éviter
  // de planter sur l'appel API et surtout de laisser l'enquête passer "active"
  // en base alors qu'elle n'a jamais été réellement publiée.
  const missing = messages.missingSendPermissions(channel, interaction.guild);
  if (missing.length) {
    return interaction.reply({
      content: `❌ Il me manque des permissions dans <#${channel.id}> pour y publier : **${missing.join(', ')}**. Corrige mes permissions sur ce salon puis réessaie.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // On ne marque l'enquête "active" qu'une fois le message réellement envoyé,
  // pour ne jamais laisser une enquête "active" sans message public associé.
  let msg;
  try {
    msg = await channel.send(messages.buildSurveyAnnouncementPayload(survey));
  } catch (err) {
    logger.error("Échec de la publication de l'enquête :", err);
    return interaction.reply({
      content: err?.code === 50013 ? `❌ Discord a refusé l'envoi dans <#${channel.id}> (permissions manquantes). Vérifie mes permissions sur ce salon.` : "❌ La publication a échoué, l'enquête reste en brouillon. Réessaie dans un instant.",
      flags: MessageFlags.Ephemeral
    });
  }

  db.prepare("UPDATE surveys SET status = 'active', channel_id = ?, message_id = ? WHERE id = ?").run(channel.id, msg.id, surveyId);
  logs.logFromInteraction(interaction, 'survey.publish', survey.name);

  const { embed: mainEmbed, components } = buildMainPanel(interaction);
  await interaction.reply({ content: `🚀 Enquête publiée dans <#${channel.id}> !`, embeds: [mainEmbed], components, flags: MessageFlags.Ephemeral });
}

/* ------------------------------------------------------------------ */
/*  LISTE DES ENQUÊTES — fusionnée dans showSurveyManagementPanel        */
/* ------------------------------------------------------------------ */

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
    { name: 'Statut', value: survey.archived ? '🗄️ Archivée' : survey.status === 'active' ? '🟢 Active' : '🔴 Fermée', inline: true },
    { name: 'Réponses reçues', value: String(responseCount), inline: true },
    { name: 'Réponses max/util.', value: survey.max_responses_per_user === 0 ? 'Illimité' : String(survey.max_responses_per_user), inline: true },
    { name: 'Confidentialité', value: describeAnonymityModes(getAnonymityModes(survey)), inline: true },
    { name: 'Salon', value: survey.channel_id ? `<#${survey.channel_id}>` : '—', inline: true },
    { name: 'Clôture auto', value: survey.close_at ? `<t:${Math.floor(survey.close_at / 1000)}:R>` : 'Aucune', inline: true }
  ];

  if (!survey.archived) {
    fields.push(
      {
        name: 'Suppression par le membre',
        value: survey.allow_self_delete ? '✅ Autorisée (mode utilisateur)' : '🔒 Désactivée — nécessite "Gérer les données"',
        inline: true
      },
      {
        name: 'Modification par le membre',
        value: survey.allow_self_edit ? '✅ Autorisée (mode utilisateur)' : '🔒 Désactivée — nécessite "Gérer les données"',
        inline: true
      }
    );
  }

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
      fields.push({ name: `❓ ${q.label}`, value: `${count} réponse(s) — voir l'export HTML pour le détail` });
    }
  }

  const embed = new EmbedBuilder()
    .setColor(survey.archived ? 0x99aab5 : 0x5865f2)
    .setTitle(`📊 Tableau de bord : ${survey.archived ? '🗄️ ' : ''}${survey.name}`)
    .addFields(fields.slice(0, 25))
    .setFooter({ text: `Questions — page ${page + 1}/${totalPages}` });

  if (survey.archived) {
    embed.setDescription("🗄️ **Enquête archivée** — lecture seule, exclue des statistiques globales, plus aucune modification possible (ni de l'enquête, ni des réponses membres) tant qu'elle n'est pas désarchivée.");
  }

  const components = [];

  if (survey.archived) {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`survey:exporthtml:${surveyId}`).setLabel('HTML').setStyle(ButtonStyle.Secondary).setEmoji('📄'),
      new ButtonBuilder().setCustomId(`survey:exportcsv:${surveyId}`).setLabel('CSV').setStyle(ButtonStyle.Secondary).setEmoji('📊'),
      new ButtonBuilder().setCustomId(`survey:charts:${surveyId}`).setLabel('Graphiques').setStyle(ButtonStyle.Secondary).setEmoji('📈')
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`survey:unarchive:${surveyId}`).setLabel('Désarchiver').setStyle(ButtonStyle.Primary).setEmoji('📤'),
      new ButtonBuilder().setCustomId(`survey:delete:${surveyId}`).setLabel('Supprimer définitivement').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
    );
    components.push(row1, row2);
  } else {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`survey:editmeta:${surveyId}`).setLabel('Modifier').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
      new ButtonBuilder().setCustomId(`survey:anonedit:${surveyId}`).setLabel('Anonymat').setStyle(ButtonStyle.Secondary).setEmoji('🎭'),
      new ButtonBuilder().setCustomId(`survey:closeat:${surveyId}`).setLabel('Clôture').setStyle(ButtonStyle.Secondary).setEmoji('📅'),
      survey.status === 'active'
        ? new ButtonBuilder().setCustomId(`survey:deactivate:${surveyId}`).setLabel('Clôturer').setStyle(ButtonStyle.Danger).setEmoji('🔒')
        : new ButtonBuilder().setCustomId(`survey:activate:${surveyId}`).setLabel('Réactiver').setStyle(ButtonStyle.Success).setEmoji('🔓')
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`survey:exporthtml:${surveyId}`).setLabel('HTML').setStyle(ButtonStyle.Secondary).setEmoji('📄'),
      new ButtonBuilder().setCustomId(`survey:charts:${surveyId}`).setLabel('Graphiques').setStyle(ButtonStyle.Secondary).setEmoji('📈'),
      new ButtonBuilder().setCustomId(`survey:duplicate:${surveyId}`).setLabel('Dupliquer').setStyle(ButtonStyle.Secondary).setEmoji('📑'),
      new ButtonBuilder().setCustomId(`survey:archive:${surveyId}`).setLabel('Archiver').setStyle(ButtonStyle.Danger).setEmoji('🗄️')
    );

    const row3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`survey:selfdelete:toggle:${surveyId}`)
        .setLabel(survey.allow_self_delete ? "Désactiver l'auto-suppression" : "Autoriser l'auto-suppression")
        .setStyle(survey.allow_self_delete ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setEmoji('🗑️'),
      new ButtonBuilder()
        .setCustomId(`survey:selfedit:toggle:${surveyId}`)
        .setLabel(survey.allow_self_edit ? "Désactiver l'auto-modification" : "Autoriser l'auto-modification")
        .setStyle(survey.allow_self_edit ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setEmoji('✏️'),
      new ButtonBuilder().setCustomId(`survey:advanced:${surveyId}`).setLabel('Avancé').setStyle(ButtonStyle.Secondary).setEmoji('🔧')
    );

    components.push(row1, row2, row3);
  }

  if (totalPages > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`survey:dash:page:${surveyId}:${page - 1}`).setLabel('◀️ Questions').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId(`survey:dash:page:${surveyId}:${page + 1}`).setLabel('Questions ▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1)
      )
    );
  }

  components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:surveys').setLabel('⬅️ Liste des enquêtes').setStyle(ButtonStyle.Secondary)));

  return { embed, components };
}

async function showDashboardPage(interaction, surveyId, page) {
  const { embed, components } = buildDashboard(surveyId, page);
  await interaction.update({ embeds: [embed], components });
}

async function setSurveyStatus(interaction, surveyId, status) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  if (survey?.archived) return showDashboardPage(interaction, surveyId, 0);
  db.prepare('UPDATE surveys SET status = ? WHERE id = ?').run(status, surveyId);
  logs.logFromInteraction(interaction, status === 'active' ? 'survey.activate' : 'survey.deactivate', survey?.name);

  const updated = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  await messages.updatePublicMessageStats(interaction.client, updated);

  const { embed, components } = buildDashboard(surveyId);
  await interaction.update({ embeds: [embed], components });
}

async function toggleSelfDelete(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  if (survey?.archived) return showDashboardPage(interaction, surveyId, 0);
  const next = survey.allow_self_delete ? 0 : 1;
  db.prepare('UPDATE surveys SET allow_self_delete = ? WHERE id = ?').run(next, surveyId);
  logs.logFromInteraction(interaction, 'survey.selfdelete.toggle', `${survey.name} → ${next ? 'autorisée' : 'désactivée'}`);

  const { embed, components } = buildDashboard(surveyId);
  await interaction.update({ embeds: [embed], components });
}

async function toggleSelfEdit(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  if (survey?.archived) return showDashboardPage(interaction, surveyId, 0);
  const next = survey.allow_self_edit ? 0 : 1;
  db.prepare('UPDATE surveys SET allow_self_edit = ? WHERE id = ?').run(next, surveyId);
  logs.logFromInteraction(interaction, 'survey.selfedit.toggle', `${survey.name} → ${next ? 'autorisée' : 'désactivée'}`);

  const { embed, components } = buildDashboard(surveyId);
  await interaction.update({ embeds: [embed], components });
}

/* ------------------------------------------------------------------ */
/*  Panneau "Avancé" d'une enquête : rôle de récompense, rappel auto,   */
/*  tirage au sort, modèle réutilisable.                                */
/* ------------------------------------------------------------------ */

function buildDashboardAdvanced(surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const winnerCount = db.prepare('SELECT COUNT(*) c FROM raffle_winners WHERE survey_id = ?').get(surveyId).c;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🔧 Options avancées : ${survey.name}`)
    .addFields(
      { name: '🏆 Rôle de récompense', value: survey.reward_role_id ? `<@&${survey.reward_role_id}> (attribué à l'envoi d'une réponse)` : 'Aucun', inline: true },
      {
        name: '⏰ Rappel automatique',
        value: survey.reminder_minutes_before
          ? `${survey.reminder_minutes_before} min avant la clôture${survey.close_at ? '' : ' *(aucune clôture programmée : sans effet)*'}${survey.reminder_sent_at ? ' — déjà envoyé' : ''}`
          : 'Désactivé',
        inline: true
      },
      { name: '🎲 Tirage au sort', value: `${winnerCount} gagnant(s) déjà tiré(s)`, inline: true },
      { name: '📑 Modèle réutilisable', value: survey.is_template ? '✅ Oui (dupliquée pour créer de vraies enquêtes)' : 'Non', inline: true }
    );

  const row1 = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`survey:rewardrole:${surveyId}`).setPlaceholder('🏆 Choisir le rôle de récompense').setMaxValues(1));
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:rewardrole:clear:${surveyId}`).setLabel('Retirer le rôle de récompense').setStyle(ButtonStyle.Secondary).setDisabled(!survey.reward_role_id),
    new ButtonBuilder().setCustomId(`survey:reminder:${surveyId}`).setLabel('Configurer le rappel').setStyle(ButtonStyle.Secondary).setEmoji('⏰')
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:exportcsv:${surveyId}`).setLabel('Export CSV').setStyle(ButtonStyle.Secondary).setEmoji('📊'),
    new ButtonBuilder().setCustomId(`survey:exportbackup:${surveyId}`).setLabel('Sauvegarde JSON').setStyle(ButtonStyle.Secondary).setEmoji('💾'),
    new ButtonBuilder().setCustomId(`survey:raffle:${surveyId}`).setLabel('Tirer un gagnant').setStyle(ButtonStyle.Primary).setEmoji('🎲'),
    new ButtonBuilder()
      .setCustomId(`survey:template:toggle:${surveyId}`)
      .setLabel(survey.is_template ? 'Retirer du statut modèle' : 'Marquer comme modèle')
      .setStyle(survey.is_template ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setEmoji('📑')
  );
  const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`survey:dash:page:${surveyId}:0`).setLabel('⬅️ Retour au tableau de bord').setStyle(ButtonStyle.Secondary));

  return { embed, components: [row1, row2, row3, back] };
}

async function showDashboardAdvanced(interaction, surveyId) {
  const { embed, components } = buildDashboardAdvanced(surveyId);
  await interaction.update({ embeds: [embed], components });
}

async function setRewardRole(interaction, surveyId) {
  const roleId = interaction.values[0];
  const survey = db.prepare('SELECT name FROM surveys WHERE id = ?').get(surveyId);
  db.prepare('UPDATE surveys SET reward_role_id = ? WHERE id = ?').run(roleId, surveyId);
  logs.logFromInteraction(interaction, 'survey.edit', `${survey.name} — rôle de récompense -> <@&${roleId}>`);
  const { embed, components } = buildDashboardAdvanced(surveyId);
  await interaction.update({ embeds: [embed], components });
}

async function clearRewardRole(interaction, surveyId) {
  const survey = db.prepare('SELECT name FROM surveys WHERE id = ?').get(surveyId);
  db.prepare('UPDATE surveys SET reward_role_id = NULL WHERE id = ?').run(surveyId);
  logs.logFromInteraction(interaction, 'survey.edit', `${survey.name} — rôle de récompense retiré`);
  const { embed, components } = buildDashboardAdvanced(surveyId);
  await interaction.update({ embeds: [embed], components });
}

async function showReminderModal(interaction, surveyId) {
  const survey = db.prepare('SELECT reminder_minutes_before FROM surveys WHERE id = ?').get(surveyId);
  const modal = new ModalBuilder().setCustomId(`survey:reminder:modal:${surveyId}`).setTitle('Rappel automatique');
  const input = new TextInputBuilder()
    .setCustomId('minutes')
    .setLabel('Minutes avant la clôture (vide = désactivé)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder('Ex : 60');
  if (survey.reminder_minutes_before) input.setValue(String(survey.reminder_minutes_before));
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function saveReminder(interaction, surveyId) {
  const raw = interaction.fields.getTextInputValue('minutes')?.trim();
  const minutes = raw ? parseInt(raw, 10) : null;
  if (raw && (!Number.isFinite(minutes) || minutes <= 0)) {
    return interaction.reply({ content: '❌ Indique un nombre de minutes positif, ou laisse vide pour désactiver.', flags: MessageFlags.Ephemeral });
  }
  const survey = db.prepare('SELECT name FROM surveys WHERE id = ?').get(surveyId);
  db.prepare('UPDATE surveys SET reminder_minutes_before = ?, reminder_sent_at = NULL WHERE id = ?').run(minutes, surveyId);
  logs.logFromInteraction(interaction, 'survey.edit', `${survey.name} — rappel -> ${minutes ? minutes + ' min avant clôture' : 'désactivé'}`);
  const { embed, components } = buildDashboardAdvanced(surveyId);
  await interaction.update({ embeds: [embed], components });
}

async function toggleTemplate(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const next = survey.is_template ? 0 : 1;
  db.prepare('UPDATE surveys SET is_template = ? WHERE id = ?').run(next, surveyId);
  logs.logFromInteraction(interaction, 'survey.edit', `${survey.name} — modèle réutilisable -> ${next ? 'oui' : 'non'}`);
  const { embed, components } = buildDashboardAdvanced(surveyId);
  await interaction.update({ embeds: [embed], components });
}

// Tire au sort un répondant non-anonyme n'ayant pas déjà gagné sur cette
// enquête. Les réponses privées/anonymes ne peuvent pas être tirées (on ne
// connaît aucune identité à annoncer).
async function drawRaffleWinner(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const candidates = db
    .prepare(
      `SELECT DISTINCT user_id FROM responses
       WHERE survey_id = ? AND is_anonymous = 0
       AND user_id NOT IN (SELECT user_id FROM raffle_winners WHERE survey_id = ?)`
    )
    .all(surveyId, surveyId)
    .map(r => r.user_id);

  if (!candidates.length) {
    const { embed, components } = buildDashboardAdvanced(surveyId);
    return interaction.update({ embeds: [embed], components, content: "🎲 Plus aucun répondant éligible à tirer (tous déjà gagnants, ou aucune réponse non-anonyme)." });
  }

  const winnerId = candidates[Math.floor(Math.random() * candidates.length)];
  db.prepare('INSERT INTO raffle_winners (survey_id, user_id, drawn_at) VALUES (?, ?, ?)').run(surveyId, winnerId, Date.now());
  logs.logFromInteraction(interaction, 'survey.raffle', `${survey.name} — gagnant : <@${winnerId}>`);

  const { embed, components } = buildDashboardAdvanced(surveyId);
  await interaction.update({ embeds: [embed], components, content: `🎉 Gagnant tiré au sort pour **${survey.name}** : <@${winnerId}> !` });
}

async function archiveSurvey(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  db.prepare('UPDATE surveys SET archived = 1, archived_at = ? WHERE id = ?').run(Date.now(), surveyId);
  db.prepare('DELETE FROM response_sessions WHERE survey_id = ?').run(surveyId); // coupe les réponses/modifications en cours
  logs.logFromInteraction(interaction, 'survey.archive', survey?.name);

  const { embed, components } = buildDashboard(surveyId);
  await interaction.update({ embeds: [embed], components });
}

async function unarchiveSurvey(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  db.prepare('UPDATE surveys SET archived = 0, archived_at = NULL WHERE id = ?').run(surveyId);
  logs.logFromInteraction(interaction, 'survey.unarchive', survey?.name);

  const { embed, components } = buildDashboard(surveyId);
  await interaction.update({ embeds: [embed], components });
}

async function confirmDeleteSurvey(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  if (!survey?.archived) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('❌ Action impossible').setDescription("Cette enquête doit d'abord être **archivée** avant de pouvoir être supprimée définitivement.")],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`survey:dash:page:${surveyId}:0`).setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary))]
    });
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`survey:delete:confirm:${surveyId}`).setLabel('Oui, supprimer définitivement').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`survey:delete:cancel:${surveyId}`).setLabel('Annuler').setStyle(ButtonStyle.Secondary)
  );
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('⚠️ Confirmation').setDescription('Supprimer cette enquête effacera définitivement aussi toutes ses réponses. Cette action est irréversible. Confirmer ?')],
    components: [row]
  });
}

async function deleteSurvey(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  if (!survey?.archived) return confirmDeleteSurvey(interaction, surveyId);
  const qids = db.prepare('SELECT id FROM questions WHERE survey_id = ?').all(surveyId).map(r => r.id);
  const rids = db.prepare('SELECT id FROM responses WHERE survey_id = ?').all(surveyId).map(r => r.id);
  if (qids.length) db.prepare(`DELETE FROM answers WHERE question_id IN (${qids.map(() => '?').join(',')})`).run(...qids);
  if (rids.length) db.prepare(`DELETE FROM responses WHERE id IN (${rids.map(() => '?').join(',')})`).run(...rids);
  db.prepare('DELETE FROM questions WHERE survey_id = ?').run(surveyId);
  db.prepare('DELETE FROM response_sessions WHERE survey_id = ?').run(surveyId);
  db.prepare('DELETE FROM surveys WHERE id = ?').run(surveyId);
  logs.logFromInteraction(interaction, 'survey.delete', survey?.name);

  await showSurveyManagementPanel(interaction);
}

async function duplicateSurvey(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const questions = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position ASC').all(surveyId);

  const info = db
    .prepare(
      `INSERT INTO surveys (guild_id, name, description, max_responses_per_user, status, anonymity_mode, anonymity_modes, close_at, created_by, created_at, allow_self_delete, allow_self_edit, reward_role_id, reminder_minutes_before)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      survey.guild_id,
      `${survey.name} (copie)`,
      survey.description,
      survey.max_responses_per_user,
      survey.anonymity_mode,
      survey.anonymity_modes,
      interaction.user.id,
      Date.now(),
      survey.allow_self_delete,
      survey.allow_self_edit,
      survey.reward_role_id,
      survey.reminder_minutes_before
    );

  const newSurveyId = info.lastInsertRowid;
  const insertQ = db.prepare(
    'INSERT INTO questions (survey_id, position, label, type, options, required, multiline, min_value, max_value, min_select, max_select) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const idMap = new Map(); // ancien id de question -> nouvel id, pour remapper la logique conditionnelle
  for (const q of questions) {
    const r = insertQ.run(newSurveyId, q.position, q.label, q.type, q.options, q.required, q.multiline, q.min_value, q.max_value, q.min_select, q.max_select);
    idMap.set(q.id, r.lastInsertRowid);
  }
  const updateCondition = db.prepare('UPDATE questions SET condition_question_id = ?, condition_value = ? WHERE id = ?');
  for (const q of questions) {
    if (q.condition_question_id && idMap.has(q.condition_question_id)) {
      updateCondition.run(idMap.get(q.condition_question_id), q.condition_value, idMap.get(q.id));
    }
  }

  logs.logFromInteraction(interaction, 'survey.duplicate', `${survey.name} → ${survey.name} (copie)`);

  const { embed, components } = buildSurveyBuilderPanel(newSurveyId);
  await interaction.update({ content: '📄 Enquête dupliquée en brouillon, modifiable ci-dessous.', embeds: [embed], components });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Génère un fichier HTML autonome (CSS inclus) avec un tableau de toutes les réponses,
// pour un visionnage plus lisible qu'un CSV brut, ouvrable dans n'importe quel navigateur.
async function exportSurveyHtml(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const questions = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position ASC').all(surveyId);
  const responses = db.prepare('SELECT * FROM responses WHERE survey_id = ? ORDER BY created_at ASC').all(surveyId);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Récupère le pseudo de chaque répondant (mis en cache pour éviter les doublons) et
  // le transforme en lien hypertexte vers discord.dog pour un lookup rapide de l'ID.
  const usernameCache = new Map();
  async function userLinkHtml(userId) {
    if (usernameCache.has(userId)) return usernameCache.get(userId);
    let label = userId;
    try {
      const user = await interaction.client.users.fetch(userId);
      label = user.username;
    } catch {
      // utilisateur introuvable (a quitté Discord, etc.) : on retombe sur l'ID
    }
    const html = `<a href="https://discord.dog/${userId}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
    usernameCache.set(userId, html);
    return html;
  }

  const rowsHtml = [];
  for (const r of responses) {
    const answers = db.prepare('SELECT * FROM answers WHERE response_id = ?').all(r.id);
    const byQ = Object.fromEntries(answers.map(a => [a.question_id, a.value]));
    const userCell = r.is_anonymous ? '🙈 Anonyme' : await userLinkHtml(r.user_id);
    const cells = [userCell, escapeHtml(new Date(r.created_at).toLocaleString('fr-FR')), ...questions.map(q => escapeHtml(byQ[q.id] ?? '—'))];
    rowsHtml.push(`<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`);
  }

  const headerHtml = ['Utilisateur', 'Date', ...questions.map(q => escapeHtml(q.label))].map(h => `<th>${h}</th>`).join('');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(survey.name)} — Résultats</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: #f2f3f5; color: #23272a; padding: 24px; }
  h1 { color: #5865f2; margin-bottom: 4px; }
  .meta { color: #4f545c; margin-bottom: 20px; }
  .meta b { color: #23272a; }
  table { border-collapse: collapse; width: 100%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  th, td { border: 1px solid #e3e5e8; padding: 8px 12px; text-align: left; font-size: 14px; vertical-align: top; }
  th { background: #5865f2; color: #fff; position: sticky; top: 0; }
  tr:nth-child(even) { background: #f9f9fb; }
  a { color: #5865f2; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <h1>📋 ${escapeHtml(survey.name)}</h1>
  <div class="meta">
    ${escapeHtml(survey.description || '')}<br>
    <b>${responses.length}</b> réponse(s) • <b>${questions.length}</b> question(s) • exporté le ${new Date().toLocaleString('fr-FR')}
  </div>
  <table>
    <thead><tr>${headerHtml}</tr></thead>
    <tbody>${rowsHtml.join('\n') || '<tr><td colspan="100">Aucune réponse pour le moment.</td></tr>'}</tbody>
  </table>
</body>
</html>`;

  const attachment = new AttachmentBuilder(Buffer.from(html, 'utf-8'), { name: `${survey.name.replace(/[^a-z0-9]+/gi, '_')}.html` });

  logs.logFromInteraction(interaction, 'survey.export', `${survey.name} (HTML)`);
  await interaction.editReply({ content: `📄 Export HTML de **${survey.name}** — ouvre le fichier dans un navigateur.`, files: [attachment] });
}

// Export CSV (ouvrable dans Excel/Google Sheets) : une ligne par réponse.
async function exportSurveyCsv(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const questions = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position ASC').all(surveyId);
  const responses = db.prepare('SELECT * FROM responses WHERE survey_id = ? ORDER BY created_at ASC').all(surveyId);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const usernameCache = new Map();
  async function username(userId) {
    if (usernameCache.has(userId)) return usernameCache.get(userId);
    let label = userId;
    try {
      label = (await interaction.client.users.fetch(userId)).username;
    } catch {
      /* utilisateur introuvable : on garde l'ID */
    }
    usernameCache.set(userId, label);
    return label;
  }

  const header = ['Utilisateur', 'ID utilisateur', 'Date', ...questions.map(q => q.label)].map(toCsvValue).join(';');
  const lines = [header];
  for (const r of responses) {
    const answers = db.prepare('SELECT * FROM answers WHERE response_id = ?').all(r.id);
    const byQ = Object.fromEntries(answers.map(a => [a.question_id, a.value]));
    const userLabel = r.is_anonymous ? 'Anonyme' : await username(r.user_id);
    const row = [userLabel, r.is_anonymous ? '' : r.user_id, new Date(r.created_at).toLocaleString('fr-FR'), ...questions.map(q => byQ[q.id] ?? '')];
    lines.push(row.map(toCsvValue).join(';'));
  }

  // BOM UTF-8 pour qu'Excel détecte correctement l'encodage des accents.
  const csv = '\uFEFF' + lines.join('\r\n');
  const attachment = new AttachmentBuilder(Buffer.from(csv, 'utf-8'), { name: `${survey.name.replace(/[^a-z0-9]+/gi, '_')}.csv` });

  logs.logFromInteraction(interaction, 'survey.export', `${survey.name} (CSV)`);
  await interaction.editReply({ content: `📊 Export CSV de **${survey.name}** — ouvrable directement dans Excel/Google Sheets.`, files: [attachment] });
}

/* ------------------------------------------------------------------ */
/*  Sauvegarde / restauration (export JSON complet d'une enquête)       */
/* ------------------------------------------------------------------ */

const BACKUP_FORMAT = 'surveybot-backup-v1';

async function exportSurveyBackup(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const questions = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position ASC').all(surveyId);
  const qLabelById = new Map(questions.map(q => [q.id, q.label]));
  const responses = db.prepare('SELECT * FROM responses WHERE survey_id = ?').all(surveyId);
  const getAnswers = db.prepare('SELECT a.value AS value, q.label AS label FROM answers a JOIN questions q ON a.question_id = q.id WHERE a.response_id = ?');

  const backup = {
    format: BACKUP_FORMAT,
    exportedAt: Date.now(),
    survey: {
      name: survey.name,
      description: survey.description,
      max_responses_per_user: survey.max_responses_per_user,
      anonymity_modes: getAnonymityModes(survey),
      allow_self_delete: !!survey.allow_self_delete,
      allow_self_edit: !!survey.allow_self_edit,
      reminder_minutes_before: survey.reminder_minutes_before
    },
    questions: questions.map(q => ({
      label: q.label,
      type: q.type,
      options: q.options ? JSON.parse(q.options) : null,
      required: !!q.required,
      multiline: !!q.multiline,
      min_value: q.min_value,
      max_value: q.max_value,
      min_select: q.min_select,
      max_select: q.max_select,
      condition_label: q.condition_question_id ? qLabelById.get(q.condition_question_id) || null : null,
      condition_value: q.condition_value
    })),
    responses: responses.map(r => ({
      user_id: r.is_anonymous ? null : r.user_id,
      is_anonymous: !!r.is_anonymous,
      is_public: r.is_public === null || r.is_public === undefined ? null : !!r.is_public,
      created_at: r.created_at,
      answers: getAnswers.all(r.id)
    }))
  };

  const attachment = new AttachmentBuilder(Buffer.from(JSON.stringify(backup, null, 2), 'utf-8'), {
    name: `${survey.name.replace(/[^a-z0-9]+/gi, '_')}_backup.json`
  });
  logs.logFromInteraction(interaction, 'survey.export', `${survey.name} (sauvegarde JSON)`);
  await interaction.reply({
    content: `💾 Sauvegarde complète de **${survey.name}** — contient les réponses et identifiants Discord des membres : garde ce fichier privé. Restaure-la avec \`/dashboard restaurer\`.`,
    files: [attachment],
    flags: MessageFlags.Ephemeral
  });
}

async function restoreSurveyFromBackup(interaction, attachment) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let backup;
  try {
    const res = await fetch(attachment.url);
    backup = await res.json();
  } catch (err) {
    logger.warn('Échec de lecture du fichier de sauvegarde :', err);
    return interaction.editReply('❌ Impossible de lire ce fichier — vérifie que c\'est bien un .json exporté depuis "💾 Sauvegarde JSON".');
  }

  if (backup?.format !== BACKUP_FORMAT || !backup.survey || !Array.isArray(backup.questions)) {
    return interaction.editReply('❌ Ce fichier ne correspond pas au format de sauvegarde attendu.');
  }

  const s = backup.survey;
  const info = db
    .prepare(
      `INSERT INTO surveys (guild_id, name, description, max_responses_per_user, status, anonymity_mode, anonymity_modes, created_by, created_at, allow_self_delete, allow_self_edit, reminder_minutes_before)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      interaction.guildId,
      `${s.name} (restaurée)`,
      s.description || null,
      s.max_responses_per_user ?? 1,
      Array.isArray(s.anonymity_modes) && s.anonymity_modes.length === 1 ? s.anonymity_modes[0] : 'choice',
      JSON.stringify(Array.isArray(s.anonymity_modes) && s.anonymity_modes.length ? s.anonymity_modes : ['semi']),
      interaction.user.id,
      Date.now(),
      s.allow_self_delete === false ? 0 : 1,
      s.allow_self_edit === false ? 0 : 1,
      s.reminder_minutes_before ?? null
    );
  const newSurveyId = info.lastInsertRowid;

  const idByLabel = new Map();
  const insertQ = db.prepare(
    'INSERT INTO questions (survey_id, position, label, type, options, required, multiline, min_value, max_value, min_select, max_select) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  backup.questions.forEach((q, i) => {
    const r = insertQ.run(newSurveyId, i, q.label, q.type, q.options ? JSON.stringify(q.options) : null, q.required ? 1 : 0, q.multiline ? 1 : 0, q.min_value ?? null, q.max_value ?? null, q.min_select ?? 1, q.max_select ?? 1);
    idByLabel.set(q.label, r.lastInsertRowid);
  });
  const updateCondition = db.prepare('UPDATE questions SET condition_question_id = ?, condition_value = ? WHERE id = ?');
  backup.questions.forEach(q => {
    if (q.condition_label && idByLabel.has(q.condition_label) && idByLabel.has(q.label)) {
      updateCondition.run(idByLabel.get(q.condition_label), q.condition_value, idByLabel.get(q.label));
    }
  });

  let restoredResponses = 0;
  if (Array.isArray(backup.responses)) {
    const insertR = db.prepare('INSERT INTO responses (survey_id, user_id, is_anonymous, is_public, created_at) VALUES (?, ?, ?, ?, ?)');
    const insertA = db.prepare('INSERT INTO answers (response_id, question_id, value) VALUES (?, ?, ?)');
    for (const r of backup.responses) {
      const rInfo = insertR.run(newSurveyId, r.is_anonymous ? 'anonymous' : r.user_id, r.is_anonymous ? 1 : 0, r.is_public === null ? null : r.is_public ? 1 : 0, r.created_at || Date.now());
      for (const a of r.answers || []) {
        if (idByLabel.has(a.label) && a.value !== null && a.value !== undefined && a.value !== '') {
          insertA.run(rInfo.lastInsertRowid, idByLabel.get(a.label), a.value);
        }
      }
      restoredResponses++;
    }
  }

  logs.logFromInteraction(interaction, 'survey.restore', `${s.name} (restaurée) — ${backup.questions.length} question(s), ${restoredResponses} réponse(s)`);
  await interaction.editReply(
    `✅ Enquête **${s.name} (restaurée)** recréée en brouillon avec ${backup.questions.length} question(s) et ${restoredResponses} réponse(s). Retrouve-la dans \`/dashboard enquete\` → 📋 Gestion des enquêtes.`
  );
}

// Génère des graphiques en barres (via l'API publique QuickChart, aucune dépendance
// locale) pour chaque question à choix, directement affichés en image dans Discord.
async function showResultsCharts(interaction, surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const questions = db.prepare("SELECT * FROM questions WHERE survey_id = ? AND type = 'choix' ORDER BY position ASC").all(surveyId);

  if (!questions.length) {
    return interaction.reply({ content: "❌ Aucune question à choix multiples dans cette enquête : rien à représenter en graphique.", flags: MessageFlags.Ephemeral });
  }

  const embeds = questions.slice(0, 4).map(q => {
    const counts = db.prepare('SELECT value, COUNT(*) c FROM answers WHERE question_id = ? GROUP BY value ORDER BY c DESC').all(q.id);
    const labels = counts.length ? counts.map(c => c.value) : ['Aucune réponse'];
    const data = counts.length ? counts.map(c => c.c) : [0];

    const chartConfig = {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Réponses', data, backgroundColor: '#5865F2' }] },
      options: { title: { display: true, text: q.label }, legend: { display: false } }
    };
    const chartUrl = `https://quickchart.io/chart?width=600&height=350&backgroundColor=white&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;

    return new EmbedBuilder().setColor(0x5865f2).setTitle(`📈 ${q.label}`).setImage(chartUrl);
  });

  if (questions.length > 4) {
    embeds[embeds.length - 1].setFooter({ text: `+${questions.length - 4} autre(s) question(s) à choix non affichée(s) ici` });
  }

  await interaction.reply({ content: `📈 Graphiques de **${survey.name}**`, embeds, flags: MessageFlags.Ephemeral });
}

/* ------------------------------------------------------------------ */
/*  GESTION DES DONNÉES (RGPD) : par utilisateur / par enquête          */
/* ------------------------------------------------------------------ */

async function showDataPanel(interaction) {
  const guildId = interaction.guildId;
  const totalResponses = db.prepare('SELECT COUNT(*) c FROM responses r JOIN surveys s ON r.survey_id = s.id WHERE s.guild_id = ?').get(guildId).c;
  const distinctUsers = db
    .prepare("SELECT COUNT(DISTINCT r.user_id) c FROM responses r JOIN surveys s ON r.survey_id = s.id WHERE s.guild_id = ? AND r.is_anonymous = 0")
    .get(guildId).c;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🗄️ Gestion des données')
    .setDescription(
      `**${totalResponses}** réponse(s) stockée(s) au total, pour **${distinctUsers}** utilisateur(s) identifié(s) (hors réponses anonymes/privées).\n\n` +
        "Choisis un **utilisateur** ou une **enquête** ci-dessous : tu pourras ensuite consulter ses réponses (export HTML) ou les supprimer."
    );

  const userSelect = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('cfg:data:user').setPlaceholder('🧑 Choisir un utilisateur').setMaxValues(1));

  const surveys = db.prepare('SELECT id, name FROM surveys WHERE guild_id = ?').all(guildId);
  const components = [userSelect];
  if (surveys.length) {
    const surveySelect = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('cfg:data:survey')
        .setPlaceholder('📋 Choisir une enquête')
        .addOptions(surveys.slice(0, 25).map(s => ({ label: s.name.slice(0, 100), value: String(s.id) })))
    );
    components.push(surveySelect);
  }
  components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:back').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)));

  await interaction.update({ embeds: [embed], components });
}

/* --------------------- Actions sur un utilisateur --------------------- */

async function selectDataUser(interaction) {
  return showDataUserPanel(interaction, interaction.values[0]);
}

async function showDataUserPanel(interaction, userId) {
  const count = db
    .prepare("SELECT COUNT(*) c FROM responses r JOIN surveys s ON r.survey_id = s.id WHERE s.guild_id = ? AND r.user_id = ? AND r.is_anonymous = 0")
    .get(interaction.guildId, userId).c;
  const blocked = perms.isBlocked(interaction.guildId, userId);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🧑 <@${userId}>`)
    .setDescription(
      `**${count}** réponse(s) identifiée(s) sur ce serveur (hors réponses anonymes/privées). Que veux-tu faire ?\n\n` +
        `Mode utilisateur (auto-gestion des réponses) : ${blocked ? '🚫 **Bloqué**' : '✅ Autorisé'}`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cfg:data:user:view:${userId}`).setLabel('Voir ses réponses (HTML)').setStyle(ButtonStyle.Secondary).setEmoji('📄').setDisabled(count === 0),
    new ButtonBuilder().setCustomId(`cfg:data:user:delete:${userId}`).setLabel('Supprimer ses données').setStyle(ButtonStyle.Danger).setEmoji('🗑️').setDisabled(count === 0)
  );
  const blockRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cfg:data:user:block:${userId}`)
      .setLabel(blocked ? 'Débloquer (mode utilisateur)' : 'Bloquer (mode utilisateur)')
      .setStyle(blocked ? ButtonStyle.Success : ButtonStyle.Danger)
      .setEmoji('🚫')
  );
  const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:data').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary));

  await interaction.update({ embeds: [embed], components: [row, blockRow, back] });
}

async function toggleUserBlock(interaction, userId) {
  const blocked = perms.toggleBlock(interaction.guildId, userId);
  logs.logFromInteraction(interaction, 'permissions.block', `<@${userId}> — ${blocked ? 'bloqué' : 'débloqué'}`);
  await showDataUserPanel(interaction, userId);
}

async function exportUserResponsesHtml(interaction, userId) {
  const guildId = interaction.guildId;
  const responses = db
    .prepare(
      `SELECT r.*, s.name AS survey_name FROM responses r JOIN surveys s ON r.survey_id = s.id
       WHERE s.guild_id = ? AND r.user_id = ? AND r.is_anonymous = 0 ORDER BY r.created_at ASC`
    )
    .all(guildId, userId);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let username = userId;
  try {
    const user = await interaction.client.users.fetch(userId);
    username = user.username;
  } catch {
    // utilisateur introuvable : on garde l'ID comme nom d'affichage
  }

  const rowsHtml = [];
  for (const r of responses) {
    const answers = db
      .prepare('SELECT a.value, q.label FROM answers a JOIN questions q ON a.question_id = q.id WHERE a.response_id = ? ORDER BY q.position ASC')
      .all(r.id);
    for (const a of answers) {
      rowsHtml.push(
        `<tr><td>${escapeHtml(r.survey_name)}</td><td>${escapeHtml(new Date(r.created_at).toLocaleString('fr-FR'))}</td><td>${escapeHtml(a.label)}</td><td>${escapeHtml(a.value)}</td></tr>`
      );
    }
  }

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Réponses de ${escapeHtml(username)}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: #f2f3f5; color: #23272a; padding: 24px; }
  h1 { color: #5865f2; margin-bottom: 4px; }
  .meta { color: #4f545c; margin-bottom: 20px; }
  table { border-collapse: collapse; width: 100%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  th, td { border: 1px solid #e3e5e8; padding: 8px 12px; text-align: left; font-size: 14px; vertical-align: top; }
  th { background: #5865f2; color: #fff; }
  tr:nth-child(even) { background: #f9f9fb; }
  a { color: #5865f2; }
</style>
</head>
<body>
  <h1>🧑 ${escapeHtml(username)}</h1>
  <div class="meta">
    <a href="https://discord.dog/${userId}" target="_blank" rel="noopener">Voir le profil (discord.dog)</a><br>
    <b>${responses.length}</b> réponse(s) sur ce serveur • exporté le ${new Date().toLocaleString('fr-FR')}
  </div>
  <table>
    <thead><tr><th>Enquête</th><th>Date</th><th>Question</th><th>Réponse</th></tr></thead>
    <tbody>${rowsHtml.join('\n') || '<tr><td colspan="4">Aucune réponse.</td></tr>'}</tbody>
  </table>
</body>
</html>`;

  const attachment = new AttachmentBuilder(Buffer.from(html, 'utf-8'), { name: `reponses_${username.replace(/[^a-z0-9]+/gi, '_')}.html` });
  logs.logFromInteraction(interaction, 'data.user.view', `<@${userId}> (HTML)`);
  await interaction.editReply({ content: `📄 Réponses de <@${userId}>`, files: [attachment] });
}

async function confirmDeleteUserData(interaction, userId) {
  const count = db
    .prepare("SELECT COUNT(*) c FROM responses r JOIN surveys s ON r.survey_id = s.id WHERE s.guild_id = ? AND r.user_id = ? AND r.is_anonymous = 0")
    .get(interaction.guildId, userId).c;

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('⚠️ Confirmation')
    .setDescription(`Supprimer définitivement les **${count}** réponse(s) de <@${userId}> sur toutes les enquêtes de ce serveur ?`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cfg:data:user:confirm:${userId}`).setLabel('Oui, supprimer').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cfg:data').setLabel('Annuler').setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

// Retire le rôle de récompense d'une enquête à un membre (best-effort, ne
// doit jamais faire planter l'appelant). Utilisé partout où une réponse est
// supprimée, en complément de l'attribution faite dans responseFlow.js.
async function revokeRewardRoleIfAny(guild, survey, userId) {
  if (!survey?.reward_role_id || !guild) return;
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member?.roles.cache.has(survey.reward_role_id)) {
      await member.roles.remove(survey.reward_role_id).catch(() => {});
    }
  } catch {
    /* best-effort */
  }
}

async function executeDataUserDeletion(interaction, userId) {
  const guildId = interaction.guildId;
  const affectedSurveys = db
    .prepare(
      `SELECT DISTINCT s.* FROM responses r JOIN surveys s ON r.survey_id = s.id
       WHERE s.guild_id = ? AND r.user_id = ? AND r.is_anonymous = 0 AND s.reward_role_id IS NOT NULL`
    )
    .all(guildId, userId);
  const responseIds = db
    .prepare("SELECT r.id FROM responses r JOIN surveys s ON r.survey_id = s.id WHERE s.guild_id = ? AND r.user_id = ? AND r.is_anonymous = 0")
    .all(guildId, userId)
    .map(r => r.id);

  if (responseIds.length) {
    db.prepare(`DELETE FROM answers WHERE response_id IN (${responseIds.map(() => '?').join(',')})`).run(...responseIds);
    db.prepare(`DELETE FROM responses WHERE id IN (${responseIds.map(() => '?').join(',')})`).run(...responseIds);
  }
  db.prepare(`DELETE FROM response_sessions WHERE user_id = ? AND survey_id IN (SELECT id FROM surveys WHERE guild_id = ?)`).run(userId, guildId);

  logs.logFromInteraction(interaction, 'data.user.delete', `<@${userId}> — ${responseIds.length} réponse(s)`);

  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Données supprimées').setDescription(`${responseIds.length} réponse(s) de <@${userId}> ont été supprimées.`)],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:data').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary))]
  });

  for (const s of affectedSurveys) await revokeRewardRoleIfAny(interaction.guild, s, userId);
}

/* --------------------- Actions sur une enquête --------------------- */

async function selectDataSurvey(interaction) {
  const surveyId = interaction.values[0];
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const count = db.prepare('SELECT COUNT(*) c FROM responses WHERE survey_id = ?').get(surveyId).c;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📋 ${survey.name}`)
    .setDescription(`**${count}** réponse(s) enregistrée(s). Que veux-tu faire ?`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cfg:data:survey:view:${surveyId}`).setLabel('Voir les réponses (HTML)').setStyle(ButtonStyle.Secondary).setEmoji('📄').setDisabled(count === 0),
    new ButtonBuilder().setCustomId(`cfg:data:survey:delete:${surveyId}`).setLabel('Vider les réponses').setStyle(ButtonStyle.Danger).setEmoji('🗑️').setDisabled(count === 0)
  );
  const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:data').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary));

  await interaction.update({ embeds: [embed], components: [row, back] });
}

async function confirmClearSurveyData(interaction, surveyId) {
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
  const filters = logFilters.get(interaction.user.id) || {};
  const total = logs.countLogs(guildId, filters);
  const totalPages = Math.max(1, Math.ceil(total / LOGS_PER_PAGE));
  page = Math.max(0, Math.min(page, totalPages - 1));
  const entries = logs.getRecentLogs(guildId, LOGS_PER_PAGE, page * LOGS_PER_PAGE, filters);

  const description = entries.length
    ? entries
        .map(e => {
          const label = logs.ACTION_LABELS[e.action] || e.action;
          const who = e.actor_id ? `<@${e.actor_id}>` : `🤖 <@${interaction.client.user.id}>`;
          const when = `<t:${Math.floor(e.created_at / 1000)}:R>`;
          return `${label} — ${who} — ${when}${e.details ? `\n> ${e.details}` : ''}`;
        })
        .join('\n\n')
    : '*Aucune action ne correspond à ces filtres.*';

  const activeFilters = [];
  if (filters.actorIds && filters.actorIds.length) activeFilters.push(`membres : ${filters.actorIds.map(id => `<@${id}>`).join(', ')}`);
  if (filters.actions && filters.actions.length) activeFilters.push(`actions : ${filters.actions.map(a => logs.ACTION_LABELS[a] || a).join(', ')}`);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📜 Journal d'audit")
    .setDescription(description)
    .setFooter({ text: `Page ${page + 1}/${totalPages} • ${total} entrée(s)${activeFilters.length ? ' • Filtres : ' + activeFilters.join(' • ') : ''}` });

  const distinctActions = logs.getDistinctActions(guildId);
  const filterRows = [];

  filterRows.push(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId('cfg:logs:filter:actor').setPlaceholder('🔎 Filtrer par membre(s)').setMinValues(0).setMaxValues(10)
    )
  );

  if (distinctActions.length) {
    filterRows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('cfg:logs:filter:action')
          .setPlaceholder('🔎 Filtrer par action(s)')
          .setMinValues(0)
          .setMaxValues(Math.min(25, distinctActions.length))
          .addOptions(distinctActions.slice(0, 25).map(a => ({ label: (logs.ACTION_LABELS[a] || a).slice(0, 100), value: a, default: (filters.actions || []).includes(a) })))
      )
    );
  }

  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cfg:logs:${page - 1}`).setLabel('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId('cfg:back').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`cfg:logs:${page + 1}`).setLabel('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1)
  );

  await interaction.update({ embeds: [embed], components: [...filterRows, nav] });
}

async function filterLogsByActor(interaction) {
  const filters = logFilters.get(interaction.user.id) || {};
  filters.actorIds = interaction.values;
  logFilters.set(interaction.user.id, filters);
  await showLogsPanel(interaction, 0);
}

async function filterLogsByAction(interaction) {
  const filters = logFilters.get(interaction.user.id) || {};
  filters.actions = interaction.values;
  logFilters.set(interaction.user.id, filters);
  await showLogsPanel(interaction, 0);
}

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  MODE UTILISATEUR : un membre gère lui-même ses propres réponses    */
/* ------------------------------------------------------------------ */

function buildUserModePanel(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const blocked = perms.isBlocked(guildId, userId);

  const surveys = db
    .prepare(
      `SELECT s.id, s.name, s.allow_self_delete, s.allow_self_edit, s.archived, COUNT(r.id) c
       FROM responses r JOIN surveys s ON r.survey_id = s.id
       WHERE s.guild_id = ? AND r.user_id = ? AND r.is_anonymous = 0
       GROUP BY s.id ORDER BY s.name`
    )
    .all(guildId, userId);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('👤 Mode utilisateur — Mes réponses')
    .setFooter({ text: 'Ce panneau est visible uniquement par toi.' });

  if (blocked) {
    embed.setDescription("🚫 Un responsable a désactivé pour toi la gestion de tes propres réponses.\nContacte un membre du staff si besoin.");
  } else if (!surveys.length) {
    embed.setDescription("Tu n'as pour l'instant fourni aucune réponse identifiable sur ce serveur (les réponses anonymes/privées ne peuvent pas être rattachées à ton compte).");
  } else {
    embed.setDescription('Choisis une enquête ci-dessous pour voir, modifier ou supprimer ta réponse.');
  }

  const components = [];
  if (!blocked && surveys.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('mode:user:survey')
      .setPlaceholder('📋 Choisir une enquête')
      .addOptions(
        surveys.slice(0, 25).map(s => {
          const tags = [];
          if (s.archived) tags.push('archivée');
          else {
            if (!s.allow_self_delete) tags.push('suppression désactivée');
            if (!s.allow_self_edit) tags.push('modification désactivée');
          }
          return {
            label: s.name.slice(0, 100),
            description: `${s.c} réponse(s)${tags.length ? ' — ' + tags.join(', ') : ''}`.slice(0, 100),
            value: String(s.id)
          };
        })
      );
    components.push(new ActionRowBuilder().addComponents(select));
  }
  if (perms.hasAnyPerm(interaction)) {
    components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mode:admin').setLabel('⬅️ Mode gestion').setStyle(ButtonStyle.Secondary)));
  }

  return { embed, components };
}

async function selectUserSurvey(interaction) {
  const surveyId = interaction.values[0];
  await showUserSurveyPanel(interaction, surveyId);
}

async function showUserSurveyPanel(interaction, surveyId) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ? AND guild_id = ?').get(surveyId, guildId);
  if (!survey) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('❌ Introuvable').setDescription("Cette enquête n'existe plus.")],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mode:user').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary))]
    });
  }

  const count = db.prepare("SELECT COUNT(*) c FROM responses WHERE survey_id = ? AND user_id = ? AND is_anonymous = 0").get(surveyId, userId).c;
  const blocked = perms.isBlocked(guildId, userId);
  const canSelfDelete = !!survey.allow_self_delete && !survey.archived;
  const canSelfEdit = !!survey.allow_self_edit && !survey.archived && survey.status === 'active';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`👤 ${survey.archived ? '🗄️ ' : ''}${survey.name}`)
    .setDescription(`Tu as **${count}** réponse(s) enregistrée(s) sur cette enquête.`);

  if (survey.archived) embed.addFields({ name: 'ℹ️', value: '🗄️ Cette enquête est archivée : elle est en lecture seule, tu peux uniquement consulter ta réponse.' });
  else if (blocked) embed.addFields({ name: 'ℹ️', value: '🚫 La gestion de tes réponses est désactivée pour toi.' });
  else {
    if (!canSelfDelete) embed.addFields({ name: 'ℹ️ Suppression', value: 'Désactivée pour cette enquête : demande à un responsable ("Gérer les données").' });
    if (!survey.allow_self_edit) embed.addFields({ name: 'ℹ️ Modification', value: 'Désactivée pour cette enquête : demande à un responsable ("Gérer les données").' });
    else if (survey.status !== 'active') embed.addFields({ name: 'ℹ️ Modification', value: "Impossible : cette enquête n'est plus active." });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mode:user:survey:view:${surveyId}`).setLabel('Voir ma réponse').setStyle(ButtonStyle.Secondary).setEmoji('👁️').setDisabled(count === 0),
    new ButtonBuilder().setCustomId(`mode:user:survey:edit:${surveyId}`).setLabel('Modifier ma réponse').setStyle(ButtonStyle.Primary).setEmoji('✏️').setDisabled(blocked || !canSelfEdit || count === 0),
    new ButtonBuilder().setCustomId(`mode:user:survey:delete:${surveyId}`).setLabel('Supprimer ma réponse').setStyle(ButtonStyle.Danger).setEmoji('🗑️').setDisabled(blocked || !canSelfDelete || count === 0)
  );
  const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mode:user').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary));

  await interaction.update({ embeds: [embed], components: [row, back] });
}

async function viewOwnResponse(interaction, surveyId) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ? AND guild_id = ?').get(surveyId, guildId);
  const responses = db
    .prepare('SELECT id, created_at FROM responses WHERE survey_id = ? AND user_id = ? AND is_anonymous = 0 ORDER BY created_at ASC')
    .all(surveyId, userId);

  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`👁️ ${survey?.name || 'Enquête'} — Ta réponse`);

  if (!responses.length) {
    embed.setDescription("Tu n'as pas de réponse enregistrée sur cette enquête.");
  } else {
    const getAnswers = db.prepare(
      `SELECT q.label, a.value FROM answers a JOIN questions q ON a.question_id = q.id WHERE a.response_id = ? ORDER BY q.position ASC`
    );
    let fieldCount = 0;
    responses.forEach((r, idx) => {
      if (responses.length > 1) {
        embed.addFields({ name: `— Réponse #${idx + 1} (<t:${Math.floor(r.created_at / 1000)}:d>) —`, value: '\u200b' });
        fieldCount++;
      }
      for (const a of getAnswers.all(r.id)) {
        if (fieldCount >= 24) return;
        embed.addFields({ name: a.label.slice(0, 256), value: (a.value === null || a.value === '' ? '*(pas de réponse)*' : String(a.value)).slice(0, 1024) });
        fieldCount++;
      }
    });
  }

  const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`mode:user:survey:cancel:${surveyId}`).setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary));
  await interaction.update({ embeds: [embed], components: [back] });
}

async function confirmDeleteOwnResponse(interaction, surveyId) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('⚠️ Confirmation')
    .setDescription('Supprimer définitivement ta réponse à cette enquête ? Cette action est irréversible.');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mode:user:survey:confirm:${surveyId}`).setLabel('Oui, supprimer').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`mode:user:survey:cancel:${surveyId}`).setLabel('Annuler').setStyle(ButtonStyle.Secondary)
  );
  await interaction.update({ embeds: [embed], components: [row] });
}

async function executeDeleteOwnResponse(interaction, surveyId) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ? AND guild_id = ?').get(surveyId, guildId);

  if (!survey || !survey.allow_self_delete || survey.archived || perms.isBlocked(guildId, userId)) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('❌ Action impossible').setDescription("Cette suppression n'est plus autorisée. Contacte un responsable si besoin.")],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mode:user').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary))]
    });
  }

  const responseIds = db
    .prepare('SELECT id FROM responses WHERE survey_id = ? AND user_id = ? AND is_anonymous = 0')
    .all(surveyId, userId)
    .map(r => r.id);

  if (responseIds.length) {
    db.prepare(`DELETE FROM answers WHERE response_id IN (${responseIds.map(() => '?').join(',')})`).run(...responseIds);
    db.prepare(`DELETE FROM responses WHERE id IN (${responseIds.map(() => '?').join(',')})`).run(...responseIds);
  }
  db.prepare('DELETE FROM response_sessions WHERE survey_id = ? AND user_id = ?').run(surveyId, userId);

  logs.log(guildId, userId, 'data.selfdelete', `<@${userId}> — « ${survey.name} » (${responseIds.length} réponse(s))`);

  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Réponse supprimée').setDescription(`Ta réponse à « ${survey.name} » a été supprimée.`)],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mode:user').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary))]
  });

  try {
    const updated = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
    await messages.updatePublicMessageStats(interaction.client, updated);
    await revokeRewardRoleIfAny(interaction.guild, updated, userId);
  } catch {
    // Rafraîchissement du message public best-effort : ne doit jamais faire planter.
  }
}

async function startEditOwnResponse(interaction, surveyId) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ? AND guild_id = ?').get(surveyId, guildId);

  if (!survey || !survey.allow_self_edit || survey.archived || survey.status !== 'active' || perms.isBlocked(guildId, userId)) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('❌ Action impossible').setDescription("La modification n'est plus autorisée pour cette enquête. Contacte un responsable si besoin.")],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mode:user').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary))]
    });
  }

  const count = db.prepare("SELECT COUNT(*) c FROM responses WHERE survey_id = ? AND user_id = ? AND is_anonymous = 0").get(surveyId, userId).c;
  if (!count) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('❌ Aucune réponse').setDescription("Tu n'as pas encore répondu à cette enquête.")],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mode:user').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary))]
    });
  }

  await flow.startResponseFlow(interaction, survey, false, true);
}

module.exports = {
  buildMainPanel,
  buildModeChooserPanel,
  buildUserModePanel,
  selectUserSurvey,
  showUserSurveyPanel,
  viewOwnResponse,
  confirmDeleteOwnResponse,
  executeDeleteOwnResponse,
  startEditOwnResponse,
  toggleSelfDelete,
  showSurveyManagementPanel,
  showChannelsPanel,
  setChannel,
  clearResponseChannel,
  setResponsesLogChannel,
  clearResponsesLogChannel,
  showPermissionsPanel,
  selectPermissionUser,
  togglePermission,
  showMpRestrictionsPanel,
  addMpRestrictionRole,
  addMpRestrictionUser,
  clearMpRestrictionsHandler,
  backToUserPermissions,
  toggleDmOnJoin,
  showWelcomeMpPanel,
  saveDmJoinMessage,
  buildDmComponents,
  handleDmDelete,
  showPresetPanel,
  handlePresetSelect,
  showBroadcastTargetPanel,
  selectBroadcastAll,
  selectBroadcastRole,
  selectBroadcastUsers,
  handleHighlightSelect,
  prepareBroadcast,
  cancelBroadcast,
  confirmBroadcast,
  showTemplateChoicePanel,
  showNewSurveyModalForTemplate,
  createSurvey,
  showGlobalStats,
  handleStatsFilter,
  handleAnonymityModeChoice,
  showAnonymityChooserButton,
  buildSurveyBuilderPanel,
  showEditMetaModal,
  saveEditMeta,
  previewSurvey,
  showCloseAtModal,
  saveCloseAt,
  startAddQuestion,
  startEditQuestion,
  handleTypeChoice,
  handleRequiredChoice,
  handleFormatChoice,
  addQuestion,
  editQuestion,
  manageQuestionSelect,
  showQuestionManagePanel,
  showConditionPicker,
  pickConditionSourceQuestion,
  setConditionValue,
  clearCondition,
  moveQuestion,
  confirmDeleteQuestion,
  executeDeleteQuestion,
  backToBuilder,
  cancelSurvey,
  publishSurvey,
  openSurveyFromSelect,
  buildDashboard,
  showDashboardPage,
  setSurveyStatus,
  toggleSelfEdit,
  archiveSurvey,
  unarchiveSurvey,
  showDashboardAdvanced,
  setRewardRole,
  clearRewardRole,
  showReminderModal,
  saveReminder,
  toggleTemplate,
  drawRaffleWinner,
  exportSurveyCsv,
  exportSurveyBackup,
  restoreSurveyFromBackup,
  confirmDeleteSurvey,
  deleteSurvey,
  duplicateSurvey,
  exportSurveyHtml,
  showResultsCharts,
  showDataPanel,
  selectDataUser,
  showDataUserPanel,
  toggleUserBlock,
  exportUserResponsesHtml,
  confirmDeleteUserData,
  executeDataUserDeletion,
  selectDataSurvey,
  confirmClearSurveyData,
  executeDataSurveyClear,
  showLogsPanel,
  filterLogsByActor,
  filterLogsByAction
};
