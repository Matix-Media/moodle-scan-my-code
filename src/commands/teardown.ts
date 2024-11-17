import { EmbedBuilder, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { eq } from "drizzle-orm";
import { ObjectCommand } from "../bot";
import { moodleConnection } from "../db/schema";

const teardownCommand: ObjectCommand = {
    data: new SlashCommandBuilder()
        .setName("teardown")
        .setDescription("Entferne die Anwesenheitserfassung für diesen Channel")
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

        const deleted = await bot.db.delete(moodleConnection).where(eq(moodleConnection.channelId, interaction.channelId)).returning();

        if (deleted.length === 0) {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xf48d2b)
                        .setDescription("Es wurde nie eine Anwesenheitserfassung für diesen Channel eingerichtet ☹️"),
                ],
                ephemeral: true,
            });
            return;
        }

        bot.setChannelConnected(interaction.channelId, false);

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xf48d2b)
                    .setDescription(`Die Anwesenheitserfassung für diesen Channel wurde erfolgreich ausgerichtet 🎉`),
            ],
            ephemeral: true,
        });
    },
};

export default teardownCommand;
