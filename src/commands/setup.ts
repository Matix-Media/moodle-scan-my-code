import { EmbedBuilder, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { ObjectCommand } from "../bot";
import { moodleConnection } from "../db/schema";

const setupCommand: ObjectCommand = {
    data: new SlashCommandBuilder()
        .setName("setup")
        .setDescription("Richte die Anwesenheitserfassung für diesen Channel ein")
        .addStringOption((option) =>
            option.setName("moodle").setDescription("Die URL deiner Moodle Instanz, z.B: https://moodle.example.com/").setRequired(true),
        )
        .setContexts(InteractionContextType.Guild)
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    execute: async (bot, interaction) => {
        if (interaction.guildId === null) {
            await interaction.reply({
                embeds: [new EmbedBuilder().setColor(0xf48d2b).setDescription("Du kannst diesen Befehl nur von einem Server aus nutzten ☹️")],
                ephemeral: true,
            });
            return;
        }

        // Sanitize the Moodle URL to ensure it does not end with a slash
        const moodleBaseUrl = interaction.options.getString("moodle", true).replace(/\/$/, "");

        await bot.db
            .insert(moodleConnection)
            .values({ channelId: interaction.channelId, moodleUrlBase: moodleBaseUrl })
            .onConflictDoUpdate({ target: moodleConnection.channelId, set: { moodleUrlBase: moodleBaseUrl } });

        bot.setChannelConnected(interaction.channelId, true);

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xf48d2b)
                    .setDescription(`Die Anwesenheitserfassung für diesen Channel wurde erfolgreich eingerichtet 🎉`),
            ],
            ephemeral: true,
        });
    },
};

export default setupCommand;
