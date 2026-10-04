import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Drizzle schema for the on-device vault. Runtime uses expo-sqlite. */
export const kv = sqliteTable('kv', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
