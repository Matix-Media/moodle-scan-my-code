import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { and, eq } from "drizzle-orm";
import { ObjectCommand } from "../bot";
import { users } from "../db/schema";
import MoodleSession from "../moodle/session";

const signupCommand: ObjectCommand = {
    data: new SlashCommandBuilder()
        .setName("signup")
        .setDescription("Moodle Anmeldedaten für eine automatische Anwesenheitserfassung angeben")
        .addStringOption((option) => option.setName("username").setDescription("Dein Moodle Benutzername").setRequired(true))
        .addStringOption((option) => option.setName("password").setDescription("Dein Passwort").setRequired(true)),
    execute: async (bot, interaction) => {
        const username = interaction.options.getString("username", true);
        const password = interaction.options.getString("password", true);

        if (interaction.guildId === null) {
            await interaction.reply({
                embeds: [new EmbedBuilder().setColor(0xf48d2b).setDescription("Du kannst diesen Befehl nur von einem Server aus nutzten ☹️")],
            });
            return;
        }

        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0xf48d2b).setDescription("[-] Teste Anmeldedaten...\n[ ] Anmeldedaten speichern")],
        });

        try {
            const session = new MoodleSession(bot);
            await session.login(username, password);
        } catch (err) {
            console.error(err);
            interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xf48d2b).setDescription("Anmeldung fehlgeschlagen ☹️\nBitte überprüfe deine Anmeldedaten.")],
            });
            return;
        }

        await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0xf48d2b).setDescription("[✓] Anmeldung erfolgreich 🎉\n[-] Speichere Anmeldedaten...")],
        });

        const existingUser = await bot.db.select().from(users).where(eq(users.discordId, interaction.user.id));
        let userOverridden = false;
        if (existingUser.length > 0) {
            userOverridden = true;
            await bot.db
                .update(users)
                .set({ discordId: interaction.user.id })
                .where(and(eq(users.discordId, interaction.user.id), eq(users.guildId, interaction.guildId)));
        } else {
            await bot.db
                .insert(users)
                .values({ discordId: interaction.user.id, username: username, password: password, guildId: interaction.guildId });
        }

        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xf48d2b)
                    .setDescription(
                        "[✓] Anmeldung erfolgreich 🎉\n[✓] Speichern der Anmeldedaten erfolgreich 🎉" +
                            (userOverridden ? " (Vorherige Anmeldedaten wurden überschrieben)" : ""),
                    ),
            ],
        });
    },
};

export default signupCommand;
