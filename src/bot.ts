import childProcess from "child_process";
import {
    CacheType,
    ChatInputCommandInteraction,
    Client,
    ClientEvents,
    EmbedBuilder,
    Events,
    GatewayIntentBits,
    Message,
    OmitPartialGroupDMChannel,
    REST,
    Routes,
    SlashCommandBuilder,
    SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import * as dotenv from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import loginCommand from "./commands/login.ts";
import logoutCommand from "./commands/logout.ts";
import setupCommand from "./commands/setup.ts";
import statusCommand from "./commands/status.ts";
import teardownCommand from "./commands/teardown.ts";
import { moodleConnection, moodleUser } from "./db/schema.ts";
import messageEvent from "./events/message.ts";
import { eq } from "drizzle-orm";
import message from "./events/message.ts";
import MoodleSession, { AttendanceUpdateError, LoginError } from "./moodle/session.ts";

export default class Bot {
    private token: string;
    private events = [messageEvent];
    private commands = [setupCommand, loginCommand, logoutCommand, statusCommand, teardownCommand];
    private connectedChannels: string[] = [];

    public readonly db: ReturnType<typeof drizzle>;
    public readonly client: Client;
    public readonly rest: REST;
    public readonly applicationId: string;

    constructor() {
        dotenv.config();
        const token = process.env.DISCORD_TOKEN;
        if (token === undefined) {
            throw new Error("DISCORD_TOKEN is not defined");
        }
        this.token = token;

        const applicationId = process.env.APPLICATION_ID;
        if (applicationId === undefined) {
            throw new Error("APPLICATION_ID is not defined");
        }
        this.applicationId = applicationId;

        const databaseUrl = process.env.DATABASE_URL;
        if (databaseUrl === undefined) {
            throw new Error("DATABASE_URL is not defined");
        }

        this.db = drizzle(databaseUrl);

        this.client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

        this.client.once(Events.ClientReady, (client) => {
            console.log(`Bot client ready, logged in as "${client.user.tag}"`);
        });

        this.client.on(Events.InteractionCreate, async (interaction) => {
            if (!interaction.isChatInputCommand()) return;

            const command = this.commands.find((command) => command.data.name === interaction.commandName);
            if (command === undefined) {
                console.log(`Unknown command: ${interaction.commandName}`);
                return;
            }

            try {
                await command.execute(this, interaction);
            } catch (err) {
                console.error(err);
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: "There was an error while executing this command!", ephemeral: true });
                } else {
                    await interaction.reply({ content: "There was an error while executing this command!", ephemeral: true });
                }
            }
        });

        this.rest = new REST({ version: "10" }).setToken(this.token);
    }

    public async start() {
        console.log("Connecting to database...");
        (await this.db.select({ channelId: moodleConnection.channelId }).from(moodleConnection)).forEach((connection) =>
            this.setChannelConnected(connection.channelId, true),
        );

        console.log("Starting bot...");

        await this.client.login(this.token);

        console.log("Registering events...");
        for (const event of this.events) {
            if (event.once) this.client.once(event.name, event.listener.bind(this, this));
            else this.client.on(event.name, event.listener.bind(this, this));
        }

        console.log("Registering commands...");
        const commandsJson: any[] = [];
        for (const command of this.commands) {
            commandsJson.push(command.data.toJSON());
        }
        await this.rest.put(Routes.applicationCommands(this.applicationId), { body: commandsJson });

        console.log("Bot started");
    }

    public setChannelConnected(channelId: string, connected: boolean) {
        if (connected) {
            this.connectedChannels.push(channelId);
        } else {
            this.connectedChannels = this.connectedChannels.filter((id) => id !== channelId);
        }
    }

    public isChannelConnected(channelId: string) {
        return this.connectedChannels.includes(channelId);
    }

    public async handleAttendanceReceived(
        url: string,
        originalMessage: OmitPartialGroupDMChannel<Message<boolean>>,
        connection: typeof moodleConnection.$inferSelect,
    ) {
        try {
            const parsedUrl = new URL(url);
            const qrPass = parsedUrl.searchParams.get("qrpass");
            if (qrPass === null) {
                console.log("QR code does not contain a valid QR pass");
                const embed = this.brandedEmbed().setDescription("QR-Code enthält keinen QR Pass ☹️");
                await originalMessage.reply({ embeds: [embed] });
                return;
            }
            const sessId = parsedUrl.searchParams.get("sessid");
            if (sessId === null) {
                console.log("QR code does not contain a valid session ID");
                const embed = this.brandedEmbed().setDescription("QR-Code enthält keine Session ID ☹️");
                await originalMessage.reply({ embeds: [embed] });
                return;
            }

            const embed = this.brandedEmbed()
                .setTitle("Hier klicken, um Anwesenheit zu erfassen")
                .setDescription(
                    "QR-Code gefunden 🎉\n\nUm deine Anwesenheit automatisch zu erfassen, nutze den `/login` Befehl, um deine Anmeldedaten zu hinterlegen.",
                )
                .setURL(url);
            await originalMessage.reply({ embeds: [embed], content: "@here" });

            const loggedInUsers = await this.db.select().from(moodleUser).where(eq(moodleUser.connectionId, connection.id));

            if (loggedInUsers.length > 0) {
                console.log(`Updating attendance for logged in users (${loggedInUsers.length} total)...`);

                const handleAttendanceUpdateError = async (user: typeof moodleUser.$inferSelect, err: any) => {
                    console.error("Error updating attendance for " + user.discordId + ":", err);
                    const dms = await this.client.users.createDM(user.discordId);
                    if (err instanceof AttendanceUpdateError) {
                        dms.send({
                            embeds: [
                                this
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
                                this
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
                                this
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
                    const session = new MoodleSession(this, connection);

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
        } catch (e) {}
    }

    public async readQrCode(url: string) {
        return new Promise<string[]>((resolve, reject) => {
            const errors: string[] = [];
            const results: string[] = [];
            const process = childProcess.spawn("python3", ["./qr-code-reader/reader.py", url]);
            process.stdout.on("data", (data) => {
                console.log(data.toString());
                if (data.toString().startsWith("RES: ")) {
                    results.push(data.toString().substring(5));
                }
            });
            process.stderr.on("data", (data) => {
                errors.push(data.toString());
                console.error(data.toString());
            });
            process.on("close", (code) => {
                if (code === 0) {
                    resolve(results);
                } else {
                    reject(errors.join("\n"));
                }
            });
        });
    }

    public brandedEmbed() {
        return new EmbedBuilder().setColor(0xf48d2b).setFooter({ text: "Moodle Scan My Code" });
    }
}

export interface ObjectEvent<T extends keyof ClientEvents> {
    name: T;
    once?: boolean;
    listener: (bot: Bot, ...args: ClientEvents[T]) => void;
}

export interface ObjectCommand {
    data: SlashCommandOptionsOnlyBuilder | SlashCommandBuilder;
    execute: (bot: Bot, interaction: ChatInputCommandInteraction<CacheType>) => void | Promise<void>;
}
