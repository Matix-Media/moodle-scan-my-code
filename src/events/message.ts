import axios from "axios";
import { EmbedBuilder, Events } from "discord.js";
import { Jimp } from "jimp";
import fetch from "node-fetch";
import QRCodeReader from "qrcode-reader";
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
            const imageRes = await downloadImage(attachment.url);

            console.log("Decoding QR code");
            const qrRes = await decodeQRCode(imageRes);

            console.log("Content:", qrRes);

            if (!qrRes.startsWith(bot.moodleUrlBase)) {
                console.log("QR code does not start with expected URL");
                const embed = new EmbedBuilder()
                    .setColor(0xf48d2b)
                    .setDescription("QR-Code enthält keine gültige URL ☹️")
                    .setThumbnail(attachment.url);
                await message.reply({ embeds: [embed] });
                return;
            }

            const embed = new EmbedBuilder()
                .setColor(0xf48d2b)
                .setDescription(`QR-Code gefunden 🎉${qrRes}`)
                .setTitle("Hier klicken, um Anwesenheit zu erfassen")
                .setURL(qrRes);
            await message.reply({ embeds: [embed] });
            console.log("Successfully processed qr code");
        } catch (e) {
            if (axios.isAxiosError(e)) {
                console.log(e.response?.data ?? e);
            } else {
                console.error(e);
            }
            const embed = new EmbedBuilder().setColor(0xf48d2b).setDescription("QR-Code konnte nicht erkannt werden ☹️").setThumbnail(attachment.url);
            await message.reply({ embeds: [embed] });
        }
    },
};

async function downloadImage(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch image from URL: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    return buffer;
}

async function decodeQRCode(buffer: ArrayBuffer): Promise<string> {
    return new Promise(async (resolve, reject) => {
        let image: Awaited<ReturnType<typeof Jimp.read>>;
        try {
            image = await Jimp.read(buffer);
        } catch (err) {
            return reject(err);
        }
        const qr = new QRCodeReader();
        qr.callback = (error: Error | null, value: { result: string }) => {
            if (error) {
                return reject(error);
            }
            resolve(value.result);
        };
        qr.decode(image.bitmap);
    });
}

export default messageEvent;
