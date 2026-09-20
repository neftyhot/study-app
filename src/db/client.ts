/**
 * SQLite connection factory. Kept free of `server-only` so CLI scripts
 * (migrate, seed) can reuse it outside the Next bundler.
 */
import { resolve } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

export function resolveDbPath() {
  const url = (process.env.DATABASE_URL ?? "./data/study-app.db").replace(
    /^file:/,
    "",
  );
  // turbopackIgnore keeps this runtime path out of the build's file trace.
  return resolve(/* turbopackIgnore: true */ process.cwd(), url);
}

export function createClient() {
  const sqlite = new Database(resolveDbPath());
  // WAL keeps ingestion writes from blocking study-session reads.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export type Db = ReturnType<typeof createClient>;
