/**
 * Applies pending migrations from ./drizzle to the local SQLite file.
 * Run with `npm run db:migrate`.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createClient, resolveDbPath } from "./client";

mkdirSync(dirname(resolveDbPath()), { recursive: true });

migrate(createClient(), { migrationsFolder: "./drizzle" });
console.log(`Migrations applied to ${resolveDbPath()}`);
