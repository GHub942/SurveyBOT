const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const perms = require('../permissions');
const { buildModeChooserPanel, buildUserModePanel, restoreSurveyFromBackup } = require('../panels');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription("Tableau de bord du bot d'enquêtes")
    // Groupe de commande : permet d'ajouter facilement d'autres sous-commandes
    // (/dashboard <autre chose>) plus tard sans casser celle-ci.
    .addSubcommand(sub => sub.setName('enquete').setDescription("Ouvre le tableau de bord des enquêtes"))
    .addSubcommand(sub =>
      sub
        .setName('restaurer')
        .setDescription('Restaure une enquête depuis un fichier de sauvegarde JSON')
        .addAttachmentOption(opt => opt.setName('fichier').setDescription('Fichier de sauvegarde (.json) généré par "💾 Sauvegarde JSON"').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'restaurer') {
      if (!perms.hasPerm(interaction, perms.PERMS.MANAGE_SURVEYS)) {
        return interaction.reply({ content: "❌ Il te faut la permission **Gérer les enquêtes** pour restaurer une sauvegarde.", flags: MessageFlags.Ephemeral });
      }
      const attachment = interaction.options.getAttachment('fichier');
      if (!attachment.name.toLowerCase().endsWith('.json')) {
        return interaction.reply({ content: '❌ Le fichier doit être un .json (export "💾 Sauvegarde JSON").', flags: MessageFlags.Ephemeral });
      }
      return restoreSurveyFromBackup(interaction, attachment);
    }

    if (sub !== 'enquete') return;

    // Un membre qui peut gérer le bot choisit d'abord son mode. Un membre
    // sans aucune permission déléguée va directement en mode utilisateur,
    // sans jamais voir le mode gestion.
    if (perms.hasAnyPerm(interaction)) {
      const { embed, components } = buildModeChooserPanel(interaction);
      return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    }

    const { embed, components } = buildUserModePanel(interaction);
    return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
  }
};
