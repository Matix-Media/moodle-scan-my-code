import { integer, pgTable, text, unique, varchar } from "drizzle-orm/pg-core";

export const moodleUser = pgTable(
    "users",
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        username: text().notNull(),
        password: text().notNull(),
        discordId: varchar({ length: 255 }).notNull(),
        connectionId: integer()
            .references(() => moodleConnection.id)
            .notNull(),
    },
    (table) => [unique().on(table.connectionId, table.discordId)],
);

export const moodleConnection = pgTable("connections", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    channelId: varchar({ length: 255 }).unique().notNull(),
    moodleUrlBase: text().notNull(),
});
