import axios from "axios";
import { EmbedBuilder, Events } from "discord.js";
import { eq } from "drizzle-orm";
import { ObjectEvent } from "../bot.ts";
import { moodleConnection, moodleUser } from "../db/schema.ts";
import MoodleSession, { AttendanceUpdateError, LoginError } from "../moodle/session.ts";

const messageEvent: ObjectEvent<Events.MessageCreate> = {
    name: Events.MessageCreate,
    listener: async (bot, message) => {
        if (message.guildId === null) return;
        if (message.author.bot) return;
        if (message.attachments.size != 1) return;
        if (!bot.isChannelConnected(message.channelId)) return;

        const attachment = message.attachments.first()!;
        if (!attachment.contentType?.startsWith("image/")) return;

        const connection = (await bot.db.select().from(moodleConnection).where(eq(moodleConnection.channelId, message.channelId)).limit(1))[0];

        try {
            console.log("Processing QR code...");

            const qrRes = await bot.readQrCode(attachment.url);

            console.log("QR codes:", qrRes);

            const validQRCode = qrRes.find((qr) => qr.startsWith(connection.moodleUrlBase + "/mod/attendance/attendance.php?qrpass="));

            if (validQRCode === undefined) {
                console.log("No valid QR code found");
                const embed = bot.brandedEmbed().setDescription("Keinen gültigen QR-Code gefunden ☹️").setThumbnail(attachment.url);
                await message.reply({ embeds: [embed] });
                return;
            }

            const qrPass = new URL(validQRCode).searchParams.get("qrpass");
            if (qrPass === null) {
                console.log("QR code does not contain a valid QR pass");
                const embed = bot.brandedEmbed().setDescription("QR-Code enthält keinen QR Pass ☹️").setThumbnail(attachment.url);
                await message.reply({ embeds: [embed] });
                return;
            }
            const sessId = new URL(validQRCode).searchParams.get("sessid");
            if (sessId === null) {
                console.log("QR code does not contain a valid session ID");
                const embed = bot.brandedEmbed().setDescription("QR-Code enthält keine Session ID ☹️").setThumbnail(attachment.url);
                await message.reply({ embeds: [embed] });
                return;
            }

            const embed = bot
                .brandedEmbed()
                .setTitle("Hier klicken, um Anwesenheit zu erfassen")
                .setDescription(
                    "QR-Code gefunden 🎉\n\nUm deine Anwesenheit automatisch zu erfassen, nutze den `/login` Befehl, um deine Anmeldedaten zu hinterlegen.",
                )
                .setURL(validQRCode);
            await message.reply({ embeds: [embed], content: "@here" });

            const loggedInUsers = await bot.db.select().from(moodleUser).where(eq(moodleUser.connectionId, connection.id));

            if (loggedInUsers.length > 0) {
                console.log(`Updating attendance for logged in users (${loggedInUsers.length} total)...`);

                const handleAttendanceUpdateError = async (user: typeof moodleUser.$inferSelect, err: any) => {
                    console.error("Error updating attendance for " + user.discordId + ":", err);
                    const dms = await bot.client.users.createDM(user.discordId);
                    if (err instanceof AttendanceUpdateError) {
                        dms.send({
                            embeds: [
                                bot
                                    .brandedEmbed()
                                    .setDescription(
                                        "Automatische Anwesenheitserfassung fehlgeschlagen ☹️\n\nKonnte die Anwesenheit nicht erfassen" +
                                            (err.reason ? ": " + err.reason : "."),
                                    ),
                            ],
                        });
                    } else if (err instanceof LoginError) {
                        dms.send({
                            embeds: [
                                bot
                                    .brandedEmbed()
                                    .setDescription(
                                        "Automatische Anwesenheitserfassung fehlgeschlagen ☹️\n\nDie Anmeldung zu deinem Account ist fehlgeschlagen" +
                                            (err.reason ? ": " + err.reason : "."),
                                    ),
                            ],
                        });
                    } else {
                        dms.send({
                            embeds: [
                                bot
                                    .brandedEmbed()
                                    .setDescription(
                                        "Automatische Anwesenheitserfassung fehlgeschlagen ☹️\n\nBei dem letzten Versuch, deine Anwesenheit automatisch zu erfassen, ist ein unbekannter Fehler aufgetreten. Bitte überprüfe deine angegebenen Anmeldedaten.",
                                    ),
                            ],
                        });
                    }
                };

                const updateAttendance = async (user: typeof moodleUser.$inferSelect, connection: typeof moodleConnection.$inferSelect) => {
                    console.log("Updating attendance for " + user.discordId + "...");
                    const session = new MoodleSession(bot, connection);

                    await session.login(user.username, user.password);
                    await session.updateAttendance(qrPass, sessId);
                };

                try {
                    await updateAttendance(loggedInUsers[0], connection);
                } catch (err) {
                    // TODO: Check if code is invalid (idk how, but it's probably possible) and return a more helpful error to the code submitter
                    await handleAttendanceUpdateError(loggedInUsers[0], err);
                }

                const updates: Promise<void>[] = loggedInUsers.slice(1).map(async (user) => {
                    try {
                        await updateAttendance(user, connection);
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

export default messageEvent;
