import fastifyStatic from "@fastify/static";
import childProcess from "child_process";
import crypto, { CipherGCM, DecipherGCM } from "crypto";
import {
    CacheType,
    ChatInputCommandInteraction,
    Client,
    ClientEvents,
    EmbedBuilder,
    Events,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    SlashCommandOptionsOnlyBuilder,
    TextChannel,
} from "discord.js";
import * as dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import fastify, { FastifyInstance } from "fastify";
import path from "path";
import loginCommand from "./commands/login.ts";
import logoutCommand from "./commands/logout.ts";
import scanCommand from "./commands/scan.ts";
import setupCommand from "./commands/setup.ts";
import statusCommand from "./commands/status.ts";
import teardownCommand from "./commands/teardown.ts";
import { moodleConnection, moodleUser } from "./db/schema.ts";
import messageEvent from "./events/message.ts";
import router from "./http/router.ts";
import MoodleSession, { AttendanceUpdateError, LoginError } from "./moodle/session.ts";

declare module "fastify" {
    interface FastifyInstance {
        bot: () => Bot;
    }
}

export default class Bot {
    private discordToken: string;
    private botUrl: string;
    private events = [messageEvent];
    private commands = [setupCommand, loginCommand, logoutCommand, statusCommand, teardownCommand, scanCommand];
    private connectedChannels: string[] = [];
    private scanTokens: Record<string, ScanToken> = {};
    private encryptionKey: Buffer<ArrayBuffer>;
    private readonly http: FastifyInstance;

    public readonly db: ReturnType<typeof drizzle>;
    public readonly client: Client;
    public readonly rest: REST;
    public readonly applicationId: string;
    public static readonly SCAN_TOKEN_EXPIRATION = 1000 * 60 * 5; // 5 minutes
    private static readonly ENCRYPTION_SETTINGS = {
        saltRounds: 10,
        algorithm: "aes-256-gcm",
        ivLength: 16,
    };

    constructor() {
        dotenv.config();
        const token = process.env.DISCORD_TOKEN;
        if (token === undefined) {
            throw new Error("DISCORD_TOKEN is not defined");
        }
        this.discordToken = token;

        const applicationId = process.env.APPLICATION_ID;
        if (applicationId === undefined) {
            throw new Error("APPLICATION_ID is not defined");
        }
        this.applicationId = applicationId;

        const botUrl = process.env.BOT_URL;
        if (botUrl === undefined) {
            throw new Error("BOT_URL is not defined");
        }
        this.botUrl = botUrl;

        const databaseUrl = process.env.DATABASE_URL;
        if (databaseUrl === undefined) {
            throw new Error("DATABASE_URL is not defined");
        }

        const encryptionKey = process.env.ENCRYPTION_KEY;
        if (encryptionKey === undefined) {
            throw new Error("ENCRYPTION_KEY is not defined");
        }
        this.encryptionKey = Buffer.from(encryptionKey, "hex");

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

        this.rest = new REST({ version: "10" }).setToken(this.discordToken);

        this.http = fastify({ logger: true });
        const staticPath = path.join(__dirname, "./http/static");
        console.log(staticPath);
        this.http.register(fastifyStatic, { root: staticPath });
        this.http.register(router);
        this.http.decorate("bot", () => this);
    }

    public async start() {
        console.log("Connecting to database...");
        (await this.db.select({ channelId: moodleConnection.channelId }).from(moodleConnection)).forEach((connection) =>
            this.setChannelConnected(connection.channelId, true),
        );

        console.log("Starting bot...");

        await this.client.login(this.discordToken);

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

        console.log("Starting HTTP server...");
        await this.http.listen({ port: 3000, host: "0.0.0.0" });

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

    public encryptPassword(password: string) {
        const iv = crypto.randomBytes(Bot.ENCRYPTION_SETTINGS.ivLength);
        const cipher = crypto.createCipheriv(Bot.ENCRYPTION_SETTINGS.algorithm, this.encryptionKey, iv) as CipherGCM;
        let encrypted = cipher.update(password, "utf8", "hex");
        encrypted += cipher.final("hex");
        const tag = cipher.getAuthTag();
        return `${iv.toString("hex")}:${encrypted}:${tag.toString("hex")}`;
    }

    public decryptPassword(encryptedPassword: string) {
        const [ivHex, encryptedHex, tagHex] = encryptedPassword.split(":");
        const iv = Buffer.from(ivHex, "hex");
        const encrypted = Buffer.from(encryptedHex, "hex");
        const tag = Buffer.from(tagHex, "hex");

        const decipher = crypto.createDecipheriv(Bot.ENCRYPTION_SETTINGS.algorithm, this.encryptionKey, iv) as DecipherGCM;
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encrypted, undefined, "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
    }

    public createScanToken(connection: typeof moodleConnection.$inferSelect, createdBy: string) {
        const token = crypto.randomBytes(16).toString("hex");
        this.scanTokens[token] = { createdAt: new Date(), connection, createdBy };
        return token;
    }

    public getScanToken(token: string) {
        const scanToken = this.scanTokens[token];
        if (scanToken === undefined) {
            return undefined;
        }
        if (scanToken.createdAt.getTime() + Bot.SCAN_TOKEN_EXPIRATION < Date.now()) {
            delete this.scanTokens[token];
            return undefined;
        }
        return scanToken;
    }

    public generateScanTokenUrl(token: string) {
        return `${this.botUrl}/scanner.html?key=${token}`;
    }

    public generateLoginUrl(connection: typeof moodleConnection.$inferSelect) {
        return `${connection.moodleUrlBase}/login/index.php`;
    }

    public async handleAttendanceReceived(
        url: string,
        onUpdate: (event: "invalid" | "success") => void,
        connection: typeof moodleConnection.$inferSelect,
    ) {
        try {
            const parsedUrl = new URL(url);
            const qrPass = parsedUrl.searchParams.get("qrpass");
            if (qrPass === null) {
                console.log("QR code does not contain a valid QR pass");
                onUpdate("invalid");
                return;
            }
            const sessId = parsedUrl.searchParams.get("sessid");
            if (sessId === null) {
                console.log("QR code does not contain a valid session ID");
                onUpdate("invalid");
                return;
            }

            onUpdate("success");

            const loggedInUsers = await this.db.select().from(moodleUser).where(eq(moodleUser.connectionId, connection.id));

            if (loggedInUsers.length > 0) {
                console.log(`Updating attendance for logged in users (${loggedInUsers.length} total)...`);

                const handleAttendanceUpdateError = async (user: typeof moodleUser.$inferSelect, err: any) => {
                    console.error("Error updating attendance for " + user.discordId + ":", err);
                    const dms = await this.client.users.createDM(user.discordId);
                    if (err instanceof AttendanceUpdateError) {
                        dms.send({
                            embeds: [
                                this.brandedEmbed().setDescription(
                                    "Automatische Anwesenheitserfassung fehlgeschlagen ☹️\n\nKonnte die Anwesenheit nicht erfassen" +
                                        (err.reason ? ": " + err.reason : "."),
                                ),
                            ],
                        });
                    } else if (err instanceof LoginError) {
                        dms.send({
                            embeds: [
                                this.brandedEmbed().setDescription(
                                    "Automatische Anwesenheitserfassung fehlgeschlagen ☹️\n\nDie Anmeldung zu deinem Account ist fehlgeschlagen" +
                                        (err.reason ? ": " + err.reason : "."),
                                ),
                            ],
                        });
                    } else if (err instanceof DecryptionError) {
                        dms.send({
                            embeds: [
                                this.brandedEmbed().setDescription(
                                    "Automatische Anwesenheitserfassung fehlgeschlagen ☹️\n\nDas Passwort für deinen Account konnte nicht entschlüsselt werden. Bitte überprüfe deine Anmeldedaten.",
                                ),
                            ],
                        });
                    } else {
                        dms.send({
                            embeds: [
                                this.brandedEmbed().setDescription(
                                    "Automatische Anwesenheitserfassung fehlgeschlagen ☹️\n\nBei dem letzten Versuch, deine Anwesenheit automatisch zu erfassen, ist ein unbekannter Fehler aufgetreten. Bitte überprüfe deine angegebenen Anmeldedaten.",
                                ),
                            ],
                        });
                    }
                };

                const updateAttendance = async (user: typeof moodleUser.$inferSelect, connection: typeof moodleConnection.$inferSelect) => {
                    console.log("Updating attendance for " + user.discordId + "...");
                    const session = new MoodleSession(this, connection);

                    let decryptedPassword: string;
                    try {
                        decryptedPassword = this.decryptPassword(user.password);
                    } catch (err) {
                        console.error("Error decrypting password for " + user.discordId + ":", err);
                        throw new DecryptionError("Failed to decrypt password");
                    }

                    await session.login(user.username, decryptedPassword);
                    await session.updateAttendance(qrPass, sessId);

                    const dms = await this.client.users.createDM(user.discordId);
                    await dms.send({
                        embeds: [
                            this.brandedEmbed().setDescription(
                                "Automatische Anwesenheitserfassung erfolgreich ✅\n\nDeine Anwesenheit wurde erfasst.",
                            ),
                        ],
                    });
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

export interface ScanToken {
    createdAt: Date;
    connection: typeof moodleConnection.$inferSelect;
    createdBy: string;
}

class DecryptionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DecryptionError";
    }
}
