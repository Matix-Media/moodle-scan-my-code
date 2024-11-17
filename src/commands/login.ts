import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { eq } from "drizzle-orm";
import { ObjectCommand } from "../bot";
import { moodleConnection, moodleUser } from "../db/schema";
import MoodleSession, { LoginError } from "../moodle/session";

const loginCommand: ObjectCommand = {
    data: new SlashCommandBuilder()
        .setName("login")
        .setDescription("Moodle Anmeldedaten für eine automatische Anwesenheitserfassung angeben")
        .addStringOption((option) => option.setName("username").setDescription("Dein Moodle Benutzername").setRequired(true))
        .addStringOption((option) => option.setName("password").setDescription("Dein Passwort").setRequired(true))
        .setContexts(InteractionContextType.Guild),
    execute: async (bot, interaction) => {
        const username = interaction.options.getString("username", true);
        const password = interaction.options.getString("password", true);

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

        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0xf48d2b).setDescription("🔄 Teste Anmeldedaten...\n🔷 Anmeldedaten speichern")],
            ephemeral: true,
        });

        try {
            const session = new MoodleSession(bot, connection);
            await session.login(username, password);
        } catch (err) {
            console.error(err);
            if (err instanceof LoginError) {
                interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xf48d2b)
                            .setDescription(`⛔ Anmeldung fehlgeschlagen ☹️${err.reason ? " " + err.reason : "."}\n~~🔺 Anmeldedaten speichern~~`),
                    ],
                });
            } else {
                interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xf48d2b)
                            .setDescription("⛔ Anmeldung fehlgeschlagen ☹️ Bitte überprüfe deine Anmeldedaten.\n~~🔺 Anmeldedaten speichern~~"),
                    ],
                });
            }
            return;
        }

        await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0xf48d2b).setDescription("✅ Anmeldung erfolgreich 🎉\n🔄 Speichere Anmeldedaten...")],
        });

        await bot.db
            .insert(moodleUser)
            .values({ discordId: interaction.user.id, username: username, password: password, connectionId: connection.id })
            .onConflictDoUpdate({ target: [moodleUser.discordId, moodleUser.connectionId], set: { username: username, password: password } });

        await interaction.editReply({
            embeds: [
                new EmbedBuilder().setColor(0xf48d2b).setDescription("✅ Anmeldung erfolgreich 🎉\n✅ Speichern der Anmeldedaten erfolgreich 🎉"),
            ],
        });
    },
};

export default loginCommand;
