import {
    CacheType,
    ChatInputCommandInteraction,
    Client,
    ClientEvents,
    Events,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import * as dotenv from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import logoutCommand from "./commands/logout.ts";
import loginCommand from "./commands/login.ts";
import messageEvent from "./events/message.ts";

export default class Bot {
    private token: string;
    private events = [messageEvent];
    private commands = [loginCommand, logoutCommand];

    public db: ReturnType<typeof drizzle>;
    public client: Client;
    public rest: REST;
    public applicationId: string;
    public guildId: string;
    public codeChannelId: string;
    public moodleUrlBase: string;

    constructor() {
        dotenv.config();
        const token = process.env.DISCORD_TOKEN;
        if (token === undefined) {
            throw new Error("DISCORD_TOKEN is not defined");
        }
        this.token = token;
        const codeChannelId = process.env.SCOPED_CHANNEL_ID;
        if (codeChannelId === undefined) {
            throw new Error("SCOPED_CHANNEL_ID is not defined");
        }
        this.codeChannelId = codeChannelId;
        const moodleUrlBase = process.env.MOODLE_URL_BASE;
        if (moodleUrlBase === undefined) {
            throw new Error("MOODLE_URL_BASE is not defined");
        }
        this.moodleUrlBase = moodleUrlBase;
        const applicationId = process.env.APPLICATION_ID;
        if (applicationId === undefined) {
            throw new Error("APPLICATION_ID is not defined");
        }
        this.applicationId = applicationId;
        const guildId = process.env.GUILD_ID;
        if (guildId === undefined) {
            throw new Error("GUILD_ID is not defined");
        }
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
