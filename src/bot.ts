import { Client, ClientEvents, Events, GatewayIntentBits } from "discord.js";
import * as dotenv from "dotenv";
import messageEvent from "./events/message.ts";

export default class Bot {
    private token: string;

    public client: Client;
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

        this.client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

        this.client.once(Events.ClientReady, (client) => {
            console.log(`Bot client ready, logged in as "${client.user.tag}"`);
        });
    }

    public async start() {
        console.log("Starting bot...");

        await this.client.login(this.token);

        console.log("Registering events...");
        const events = [messageEvent];
        for (const event of events) {
            if (event.once) this.client.once(event.name, event.listener.bind(this, this));
            else this.client.on(event.name, event.listener.bind(this, this));
        }

        console.log("Bot started");
    }
}

export interface ObjectEvent<T extends keyof ClientEvents> {
    name: T;
    once?: boolean;
    listener: (bot: Bot, ...args: ClientEvents[T]) => void;
}
