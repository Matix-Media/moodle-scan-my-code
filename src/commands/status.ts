import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { and, eq } from "drizzle-orm";
import { ObjectCommand } from "../bot";
import { moodleConnection, moodleUser } from "../db/schema";
import MoodleSession from "../moodle/session";

const statusCommand: ObjectCommand = {
    data: new SlashCommandBuilder()
        .setName("status")
        .setDescription("Status der eingerichteten Anwesenheitserfassung überprüfen")
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

        const connection = (await bot.db.select().from(moodleConnection).where(eq(moodleConnection.channelId, interaction.channelId)).limit(1))[0];

        const existingUser = await bot.db
            .select()
            .from(moodleUser)
            .where(and(eq(moodleUser.discordId, interaction.user.id), eq(moodleUser.connectionId, connection.id)))
            .limit(1);
        if (existingUser.length === 0) {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xf48d2b)
                        .setDescription(
                            `Es ist eine Anwesenheitserfassung für diesen Channel eingerichtet ✔️\nMoodle-URL: ${connection.moodleUrlBase}\n\nDu hast keine Anmeldedaten gespeichert ☹️`,
                        ),
                ],
                ephemeral: true,
            });
            return;
        }

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xf48d2b)
                    .setDescription(
                        `Es ist eine Anwesenheitserfassung für diesen Channel eingerichtet ✔️\nMoodle-URL: ${connection.moodleUrlBase}\n\n` +
                            `Anmeldedaten bereits hinterlegt ✔️\nAktuelle Anmeldename: \`${existingUser[0].username}\`\n\n🔄 Überprüfe Anmeldedaten...`,
                    ),
            ],
            ephemeral: true,
        });

        try {
            const session = new MoodleSession(bot, connection);
            await session.login(existingUser[0].username, bot.decryptPassword(existingUser[0].password));
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xf48d2b)
                        .setDescription(
                            `Es ist eine Anwesenheitserfassung für diesen Channel eingerichtet ✔️\nMoodle-URL: ${connection.moodleUrlBase}\n\nAnmeldedaten bereits hinterlegt ✔️\nAktuelle Anmeldename: \`` +
                                existingUser[0].username +
                                "`\n\n✅ Anmeldedaten erfolgreich überprüft 🎉",
                        ),
                ],
            });
        } catch (err) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xf48d2b)
                        .setDescription(
                            `Es ist eine Anwesenheitserfassung für diesen Channel eingerichtet ✔️\nMoodle-URL: ${connection.moodleUrlBase}\n\nAnmeldedaten bereits hinterlegt ✔️\nAktuelle Anmeldename: \`` +
                                existingUser[0].username +
                                "`\n\n⛔ Anmeldung fehlgeschlagen ☹️ Bitte überprüfe deine Anmeldedaten.",
                        ),
                ],
            });
        }
    },
};

export default statusCommand;
