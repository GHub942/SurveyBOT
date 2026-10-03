const { SlashCommandBuilder } = require('discord.js');
const perms = require('../permissions');
const { buildModeChooserPanel, buildUserModePanel } = require('../panels');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription("Tableau de bord du bot d'enquêtes")
    // Groupe de commande : permet d'ajouter facilement d'autres sous-commandes
    // (/dashboard <autre chose>) plus tard sans casser celle-ci.
    .addSubcommand(sub => sub.setName('enquete').setDescription("Ouvre le tableau de bord des enquêtes")),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub !== 'enquete') return;

    // Un membre qui peut gérer le bot choisit d'abord son mode. Un membre
    // sans aucune permission déléguée va directement en mode utilisateur,
    // sans jamais voir le mode gestion.
    if (perms.hasAnyPerm(interaction)) {
      const { embed, components } = buildModeChooserPanel(interaction);
      return interaction.reply({ embeds: [embed], components, ephemeral: true });
    }

    const { embed, components } = buildUserModePanel(interaction);
    return interaction.reply({ embeds: [embed], components, ephemeral: true });
  }
};
