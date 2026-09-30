/**
 * Copies the installed app's courses, cards and uploads into the development
 * data folder, so `npm run electron:dev` shows the same study data.
 *
 *   npm run dev:data
 *
 * A one-way snapshot: the installed app's files are only read, and SQLite's
 * backup API copies a consistent database even while that app is open. The
 * development database it replaces is kept beside it, and the copy is then
 * migrated to this code's schema — the installed app never sees that.
 * Quit `electron:dev` first; it holds the development database open.
 */
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createClient, resolveDbPath } from "../src/db/client";

function installedDataDir() {
  const name = "Megan Study";
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", name, "data");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), name, "data");
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), name, "data");
}

async function main() {
  const source = process.env.INSTALLED_DATA_DIR ?? installedDataDir();
  const sourceDb = join(source, "study-app.db");
  if (!existsSync(sourceDb)) {
    throw new Error(`No installed app data at ${sourceDb}`);
  }

  const target = resolveDbPath();
  const dataDir = dirname(target);
  const uploads = process.env.UPLOADS_DIR ?? join(dataDir, "uploads");
  mkdirSync(dataDir, { recursive: true });

  // Keep what was here, database and uploads together.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const kept = join(dataDir, `dev-before-${stamp}`);
  if (existsSync(target) || existsSync(uploads)) {
    mkdirSync(kept, { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) {
      if (existsSync(target + suffix)) renameSync(target + suffix, join(kept, `study-app.db${suffix}`));
    }
    if (existsSync(uploads)) renameSync(uploads, join(kept, "uploads"));
    console.log(`Previous development data kept in ${kept}`);
  }

  const installed = new Database(sourceDb, { readonly: true, fileMustExist: true });
  try {
    await installed.backup(target);
  } finally {
    installed.close();
  }

  const sourceUploads = join(source, "uploads");
  if (existsSync(sourceUploads)) cpSync(sourceUploads, uploads, { recursive: true });
  else rmSync(uploads, { recursive: true, force: true });

  migrate(createClient(), { migrationsFolder: "./drizzle" });

  const check = new Database(target, { readonly: true });
  const count = (table: string) =>
    (check.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  console.log(
    `Copied ${count("exams")} courses and ${count("flashcards")} cards from ${source} to ${dataDir}, migrated.`,
  );
  check.close();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
