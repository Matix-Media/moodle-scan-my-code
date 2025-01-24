import axios from "axios";
import { EmbedBuilder, Events } from "discord.js";
import { eq } from "drizzle-orm";
import { ObjectEvent } from "../bot.ts";
import { moodleConnection } from "../db/schema.ts";

const messageEvent: ObjectEvent<Events.MessageCreate> = {
    name: Events.MessageCreate,
    listener: async (bot, message) => {
        if (message.guildId === null) return;
        if (message.author.bot) return;
        if (!bot.isChannelConnected(message.channelId)) return;

        const connection = (await bot.db.select().from(moodleConnection).where(eq(moodleConnection.channelId, message.channelId)).limit(1))[0];
        if (!connection) {
            console.warn("No connection found for channel", message.channelId);
            return;
        }

        const loginUrl = connection.moodleUrlBase + "/mod/attendance/attendance.php?qrpass=";

        if (message.attachments.size != 1) {
            if (!message.content.startsWith(loginUrl)) return;
            bot.handleAttendanceReceived(message.content, message, connection);
        } else {
            const attachment = message.attachments.first()!;
            if (!attachment.contentType?.startsWith("image/")) return;

            try {
                console.log("Processing QR code...");
                const qrRes = await bot.readQrCode(attachment.url);
                console.log("QR codes:", qrRes);
                const validQRCode = qrRes.find((qr) => qr.startsWith(loginUrl));

                if (validQRCode === undefined) {
                    console.log("No valid QR code found");
                    const embed = bot.brandedEmbed().setDescription("Keinen gültigen QR-Code gefunden ☹️").setThumbnail(attachment.url);
                    await message.reply({ embeds: [embed] });
                    return;
                }
                bot.handleAttendanceReceived(validQRCode, message, connection);
            } catch (e) {
                if (axios.isAxiosError(e)) {
                    console.log(e.response?.data ?? e);
                } else {
                    console.error(e);
                }
                const embed = new EmbedBuilder()
                    .setColor(0xf48d2b)
                    .setDescription("QR-Code konnte nicht erkannt werden ☹️")
                    .setThumbnail(attachment.url);
                await message.reply({ embeds: [embed] });
            }
        }
    },
};

export default messageEvent;
