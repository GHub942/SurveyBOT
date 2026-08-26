const { SlashCommandBuilder } = require('discord.js');
const { isAuthorized } = require('../utils');
const { buildMainPanel } = require('../panels');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription("Ouvre le panneau de configuration du bot d'enquêtes"),

  async execute(interaction) {
    if (!isAuthorized(interaction)) {
      return interaction.reply({
        content:
          "❌ Tu n'as pas la permission d'utiliser cette commande.\nIl faut la permission **Gérer le serveur**, ou être ajouté à la liste blanche.",
        ephemeral: true
      });
    }

    const { embed, components } = buildMainPanel(interaction.guildId);
    await interaction.reply({ embeds: [embed], components, ephemeral: true });
  }
};
