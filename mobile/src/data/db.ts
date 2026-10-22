/**
 * Opening the iOS database: the desktop's own migrations, applied through the
 * shared runner, so the two apps always agree on the schema.
 */
import { runMigrations, type BundledMigration } from "@megan/core/platform/migrate";
import type { SqlDriver } from "@megan/core/platform/types";

/** Brings a database up to date. Returns the migrations it applied. */
export async function prepareDatabase(db: SqlDriver, migrations: BundledMigration[]): Promise<string[]> {
  await db.exec("PRAGMA foreign_keys = ON");
  return runMigrations(db, migrations);
}

export const newId = (): string => crypto.randomUUID();

export const nowIso = (): string => new Date().toISOString();

/** SQLite stores booleans as 0/1; the plugin and better-sqlite3 both hand back numbers. */
export const bool = (value: unknown): boolean => value === 1 || value === true || value === "1";

export function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
