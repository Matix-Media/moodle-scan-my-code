import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { and, eq } from "drizzle-orm";
import { ObjectCommand } from "../bot";
import { users } from "../db/schema";
import MoodleSession from "../moodle/session";

const statusCommand: ObjectCommand = {
    data: new SlashCommandBuilder().setName("status").setDescription("Status der Moodle Anmeldedaten überprüfen"),
    execute: async (bot, interaction) => {
        if (interaction.guildId === null) {
            await interaction.reply({
                embeds: [new EmbedBuilder().setColor(0xf48d2b).setDescription("Du kannst diesen Befehl nur von einem Server aus nutzten ☹️")],
                ephemeral: true,
            });
            return;
        }

        const existingUser = await bot.db
            .select()
            .from(users)
            .where(and(eq(users.discordId, interaction.user.id), eq(users.guildId, interaction.guildId)));
        if (existingUser.length === 0) {
            await interaction.reply({
                embeds: [new EmbedBuilder().setColor(0xf48d2b).setDescription("Du hast keine Anmeldedaten gespeichert ☹️")],
                ephemeral: true,
            });
            return;
        }

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xf48d2b)
                    .setDescription(
                        "Anmeldedaten bereits hinterlegt 🎉\nAktuelle Anmeldename: `" +
                            existingUser[0].username +
                            "`\n\n[-] Überprüfe Anmeldedaten...",
                    ),
            ],
            ephemeral: true,
        });

        try {
            const session = new MoodleSession(bot);
            await session.login(existingUser[0].username, existingUser[0].password);
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xf48d2b)
                        .setDescription(
                            "Anmeldedaten bereits hinterlegt 🎉\nAktuelle Anmeldename: `" +
                                existingUser[0].username +
                                "`\n\n[✓] Anmeldung erfolgreich 🎉",
                        ),
                ],
            });
        } catch (err) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xf48d2b)
                        .setDescription(
                            "Anmeldedaten bereits hinterlegt 🎉\nAktuelle Anmeldename: `" +
                                existingUser[0].username +
                                "`\n\n[X] Anmeldung fehlgeschlagen ☹️\nBitte überprüfe deine Anmeldedaten.",
                        ),
                ],
            });
        }
    },
};

export default statusCommand;
