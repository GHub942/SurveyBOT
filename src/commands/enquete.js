const { SlashCommandBuilder } = require('discord.js');
const db = require('../database');
const { startResponseFlow, alreadyMaxedOut } = require('../responseFlow');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('enquete')
    .setDescription('Répondre à une enquête active sur ce serveur')
    .addStringOption(opt =>
      opt
        .setName('enquete')
        .setDescription("Nom de l'enquête à laquelle répondre")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const rows = db
      .prepare("SELECT name FROM surveys WHERE guild_id = ? AND status = 'active'")
      .all(interaction.guildId);
    const filtered = rows.filter(r => r.name.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(filtered.map(r => ({ name: r.name, value: r.name })));
  },

  async execute(interaction) {
    const name = interaction.options.getString('enquete');
    const survey = db
      .prepare("SELECT * FROM surveys WHERE guild_id = ? AND name = ? AND status = 'active'")
      .get(interaction.guildId, name);

    if (!survey) {
      return interaction.reply({
        content: "❌ Cette enquête n'existe pas ou n'est plus active sur ce serveur.",
        ephemeral: true
      });
    }

    if (alreadyMaxedOut(survey, interaction.user.id)) {
      return interaction.reply({
        content: `❌ Tu as déjà atteint le nombre maximum de réponses autorisées pour **${survey.name}** (${survey.max_responses_per_user}).`,
        ephemeral: true
      });
    }

    await startResponseFlow(interaction, survey);
  }
};
