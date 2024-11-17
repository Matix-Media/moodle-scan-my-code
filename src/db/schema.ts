import { integer, pgTable, text, varchar } from "drizzle-orm/pg-core";

export const moodleUser = pgTable("users", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    username: text().notNull(),
    password: text().notNull(),
    discordId: varchar({ length: 255 }).notNull(),
    connectionId: integer()
        .references(() => moodleConnection.id)
        .notNull(),
});

export const moodleConnection = pgTable("connections", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    channelId: varchar({ length: 255 }).notNull(),
    moodleUrlBase: text().notNull(),
});
