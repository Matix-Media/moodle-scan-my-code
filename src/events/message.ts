import axios from "npm:axios";
import { EmbedBuilder, Events } from "npm:discord.js";
import { ObjectEvent } from "../bot.ts";

const messageEvent: ObjectEvent<Events.MessageCreate> = {
    name: Events.MessageCreate,
    listener: async (bot, message) => {
        if (message.channel.id !== bot.codeChannelId) return;
        if (message.author.bot) return;
        if (message.attachments.size != 1) {
            console.log("Received message with no or too many attachments");
            return;
        }

        console.log(`Received message from ${message.author.tag}`);

        const attachment = message.attachments.first()!;
        if (!attachment.contentType?.startsWith("image/")) {
            console.log("Received message with non-image attachment");
            return;
        }

        try {
            console.log("Processing QR code...");

            console.log("Downloading attachment");
            const imageRes = await axios.get(attachment.url);
            console.log("Decoding QR code at remote server");
            const qrRes = await axios.postForm(
                "https://api.qrserver.com/v1/read-qr-code/",
                { file: imageRes.data },
                { headers: { "Content-Type": "multipart/form-data" } },
            );
            console.log(qrRes.data);
        } catch (e) {
            if (axios.isAxiosError(e)) {
                console.log(e.response?.data ?? e);
            } else {
                console.error(e);
            }
            const embed = new EmbedBuilder().setColor(0xf48d2b).setDescription("QR-Code konnte nicht erkannt werden ☹️").setThumbnail(attachment.url);
            await message.reply({ embeds: [embed] });
        }

        /*

        if (!qrResult.data.startsWith(bot.moodleUrlBase)) {
            console.log("QR code does not start with expected URL");
            const embed = new EmbedBuilder().setColor(0xf48d2b).setDescription("QR-Code enthält keine URL ☹️");
            await message.reply({ embeds: [embed] });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0xf48d2b)
            .setDescription(`QR-Code gefunden 🎉${qrResult.data}`)
            .setTitle("Hier klicken, um Anwesenheit zu erfassen")
            .setURL(qrResult.data);
        await message.reply({ embeds: [embed] });
        console.log("Successfully processed qr code");*/
    },
};

export default messageEvent;
