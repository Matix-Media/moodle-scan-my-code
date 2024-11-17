import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { and, eq } from "drizzle-orm";
import { ObjectCommand } from "../bot";
import { moodleConnection, moodleUser } from "../db/schema";

const logoutCommand: ObjectCommand = {
    data: new SlashCommandBuilder()
        .setName("logout")
        .setDescription("Moodle Anmeldedaten für eine automatische Anwesenheitserfassung löschen")
        .setContexts(InteractionContextType.Guild),
    execute: async (bot, interaction) => {
        if (interaction.guildId === null) {
            await interaction.reply({
                embeds: [new EmbedBuilder().setColor(0xf48d2b).setDescription("Du kannst diesen Befehl nur von einem Server aus nutzten ☹️")],
                ephemeral: true,
            });
            return;
        }
        if (!bot.isChannelConnected(interaction.channelId)) {
            await interaction.reply({
                embeds: [new EmbedBuilder().setColor(0xf48d2b).setDescription("Für diesen Channel ist keine Anwesenheitserfassung eingerichtet ☹️")],
                ephemeral: true,
            });
            return;
        }

        const existingUser = await bot.db
            .select()
            .from(moodleUser)
            .innerJoin(moodleConnection, eq(moodleUser.connectionId, moodleConnection.id))
            .where(and(eq(moodleUser.discordId, interaction.user.id), eq(moodleConnection.channelId, interaction.channelId)))
            .limit(1);
        if (existingUser.length === 0) {
            await interaction.reply({
                embeds: [new EmbedBuilder().setColor(0xf48d2b).setDescription("Du hast keine Anmeldedaten gespeichert ☹️")],
                ephemeral: true,
            });
            return;
        }

        await bot.db.delete(moodleUser).where(eq(moodleUser.id, existingUser[0].users.id));

        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0xf48d2b).setDescription("Anmeldedaten erfolgreich gelöscht 🎉")],
            ephemeral: true,
        });
    },
};

export default logoutCommand;
