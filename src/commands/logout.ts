import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { and, eq } from "drizzle-orm";
import { ObjectCommand } from "../bot";
import { users } from "../db/schema";

const logoutCommand: ObjectCommand = {
    data: new SlashCommandBuilder().setName("logout").setDescription("Moodle Anmeldedaten für eine automatische Anwesenheitserfassung löschen"),
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

        await bot.db.delete(users).where(and(eq(users.discordId, interaction.user.id), eq(users.guildId, interaction.guildId)));

        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0xf48d2b).setDescription("Anmeldedaten erfolgreich gelöscht 🎉")],
            ephemeral: true,
        });
    },
};

export default logoutCommand;
