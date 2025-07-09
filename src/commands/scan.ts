import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { eq } from "drizzle-orm";
import Bot, { ObjectCommand } from "../bot";
import { moodleConnection } from "../db/schema";

const scanCommand: ObjectCommand = {
    data: new SlashCommandBuilder().setName("scan").setDescription("Scanne einen QR-Code"),
    execute: async (bot, interaction) => {
        if (interaction.guildId == null) {
            await interaction.reply({
                embeds: [new EmbedBuilder().setColor(0xf48d2b).setDescription("Du kannst diesen Befehl nur von einem Server aus nutzten ☹️")],
            });
            return;
        }

        if (!bot.isChannelConnected(interaction.channelId)) {
            await interaction.reply({
                embeds: [new EmbedBuilder().setColor(0xf48d2b).setDescription("Für diesen Channel ist keine Anwesenheitserfassung eingerichtet ☹️")],
            });
            return;
        }

        const connection = (await bot.db.select().from(moodleConnection).where(eq(moodleConnection.channelId, interaction.channelId)).limit(1))[0];

        const token = bot.createScanToken(connection, interaction.user.id);
        await interaction.reply({
            embeds: [bot.brandedEmbed().setDescription(`Du kannst den QR-Code über folgende URL scannen: ${bot.generateScanTokenUrl(token)}`)],
            ephemeral: true,
        });

        setTimeout(async () => {
            await interaction.editReply({
                embeds: [bot.brandedEmbed().setDescription("Die Scan-URL ist abgelaufen. Nutze den `/scan` Befehl, um eine neue zu generieren.")],
            });
        }, Bot.SCAN_TOKEN_EXPIRATION);
    },
};

export default scanCommand;
