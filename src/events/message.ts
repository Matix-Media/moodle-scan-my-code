import axios from "axios";
import { EmbedBuilder, Events } from "discord.js";
import { eq } from "drizzle-orm";
import { Jimp } from "jimp";
import fetch from "node-fetch";
import QRCodeReader from "qrcode-reader";
import { ObjectEvent } from "../bot.ts";
import { users } from "../db/schema.ts";
import MoodleSession, { AttendanceUpdateError, LoginError } from "../moodle/session.ts";

const messageEvent: ObjectEvent<Events.MessageCreate> = {
    name: Events.MessageCreate,
    listener: async (bot, message) => {
        if (!bot.codeChannelIds.includes(message.channel.id)) return;
        if (message.guildId === null) return;
        if (message.author.bot) return;
        if (message.attachments.size != 1) return;

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

            if (!qrRes.startsWith(bot.moodleUrlBase + "/mod/attendance/attendance.php?qrpass=")) {
                console.log("QR code does not start with expected URL");
                const embed = new EmbedBuilder()
                    .setColor(0xf48d2b)
                    .setDescription("QR-Code enthält keine gültige URL ☹️")
                    .setThumbnail(attachment.url);
                await message.reply({ embeds: [embed] });
                return;
            }

            const qrPass = new URL(qrRes).searchParams.get("qrpass");
            if (qrPass === null) {
                console.log("QR code does not contain a valid QR pass");
                const embed = new EmbedBuilder().setColor(0xf48d2b).setDescription("QR-Code enthält keinen QR Pass ☹️").setThumbnail(attachment.url);
                await message.reply({ embeds: [embed] });
                return;
            }
            const sessId = new URL(qrRes).searchParams.get("sessid");
            if (sessId === null) {
                console.log("QR code does not contain a valid session ID");
                const embed = new EmbedBuilder()
                    .setColor(0xf48d2b)
                    .setDescription("QR-Code enthält keine Session ID ☹️")
                    .setThumbnail(attachment.url);
                await message.reply({ embeds: [embed] });
                return;
            }

            const embed = new EmbedBuilder()
                .setColor(0xf48d2b)
                .setTitle("Hier klicken, um Anwesenheit zu erfassen")
                .setDescription(
                    "QR-Code gefunden 🎉\n\nUm deine Anwesenheit automatisch zu erfassen, nutze den `/login` Befehl, um deine Anmeldedaten zu hinterlegen.",
                )
                .setURL(qrRes);
            await message.reply({ embeds: [embed] });

            const loggedInUsers = await bot.db.select().from(users).where(eq(users.guildId, message.guildId));

            if (loggedInUsers.length > 0) {
                console.log(`Updating attendance for logged in users (${loggedInUsers.length} total)...`);

                const handleAttendanceUpdateError = async (user: typeof users.$inferSelect, err: any) => {
                    console.error("Error updating attendance for " + user.discordId + ":", err);
                    const dms = await bot.client.users.createDM(user.discordId);
                    if (err instanceof AttendanceUpdateError) {
                        dms.send({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(0xf48d2b)
                                    .setDescription(
                                        "Automatische Anwesenheitserfassung fehlgeschlagen ☹️\n\nKonnte die Anwesenheit nicht erfassen" +
                                            (err.reason ? ": " + err.reason : "."),
                                    ),
                            ],
                        });
                    } else if (err instanceof LoginError) {
                        dms.send({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(0xf48d2b)
                                    .setDescription(
                                        "Automatische Anwesenheitserfassung fehlgeschlagen ☹️\n\nDie Anmeldung zu deinem Account ist fehlgeschlagen" +
                                            (err.reason ? ": " + err.reason : "."),
                                    ),
                            ],
                        });
                    } else {
                        dms.send({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(0xf48d2b)
                                    .setDescription(
                                        "Automatische Anwesenheitserfassung fehlgeschlagen ☹️\n\nBei dem letzten Versuch, deine Anwesenheit automatisch zu erfassen, ist ein unbekannter Fehler aufgetreten. Bitte überprüfe deine angegebenen Anmeldedaten.",
                                    ),
                            ],
                        });
                    }
                };

                const updateAttendance = async (user: typeof users.$inferSelect) => {
                    console.log("Updating attendance for " + user.discordId + "...");
                    const session = new MoodleSession(bot);

                    await session.login(user.username, user.password);
                    await session.updateAttendance(qrPass, sessId);
                };

                try {
                    await updateAttendance(loggedInUsers[0]);
                } catch (err) {
                    // TODO: Check if code is invalid (idk how, but it's probably possible) and return a more helpful error to the code submitter
                    await handleAttendanceUpdateError(loggedInUsers[0], err);
                }

                const updates: Promise<void>[] = loggedInUsers.slice(1).map(async (user) => {
                    try {
                        await updateAttendance(user);
                    } catch (err) {
                        await handleAttendanceUpdateError(user, err);
                    }
                });
                await Promise.all(updates);
            }

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
