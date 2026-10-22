/**
 * Applies the app's schema migrations through any `SqlDriver`.
 *
 * The desktop runs drizzle's own migrator at startup; this does exactly what
 * that one does — same bookkeeping table, same hashes, same "newer than the
 * last applied" rule — so a database moved between the two is never migrated
 * twice or skipped. `platform/migrate.test.ts` holds it to that.
 *
 * The migrations themselves are read at build time (there is no file system
 * on iOS to read `drizzle/` from): `bundleMigrations` turns the journal and
 * the `.sql` files into a list the app ships with.
 */
import type { SqlDriver } from "./types";

export const MIGRATIONS_TABLE = "__drizzle_migrations";
const BREAKPOINT = "--> statement-breakpoint";

export type BundledMigration = {
  tag: string;
  /** The journal's `when`, which drizzle records as `created_at`. */
  when: number;
  /** sha256 of the `.sql` file's text, as drizzle computes it. */
  hash: string;
  statements: string[];
};

type Journal = { entries: { tag: string; when: number }[] };

/**
 * Builds the shipped list. `hash` is passed in because hashing is a Node or
 * WebCrypto call, and this file runs in both.
 */
export function bundleMigrations(
  journal: Journal,
  readSql: (tag: string) => string,
  hash: (text: string) => string,
): BundledMigration[] {
  return journal.entries.map(({ tag, when }) => {
    const text = readSql(tag);
    return { tag, when, hash: hash(text), statements: text.split(BREAKPOINT) };
  });
}

/** Applies every migration newer than the last one recorded. Returns the tags applied. */
export async function runMigrations(db: SqlDriver, migrations: BundledMigration[]): Promise<string[]> {
  // Tab-indented exactly as drizzle writes it, so sqlite_master matches too.
  await db.exec(
    `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (\n\t\t\t\tid SERIAL PRIMARY KEY,\n\t\t\t\thash text NOT NULL,\n\t\t\t\tcreated_at numeric\n\t\t\t)`,
  );
  const [last] = await db.all<{ created_at: number | string | null }>(
    `SELECT id, hash, created_at FROM "${MIGRATIONS_TABLE}" ORDER BY created_at DESC LIMIT 1`,
  );
  const lastWhen = last ? Number(last.created_at) : null;

  const applied: string[] = [];
  await db.transaction(async () => {
    for (const migration of migrations) {
      if (lastWhen !== null && !(lastWhen < migration.when)) continue;
      for (const statement of migration.statements) {
        if (statement.trim()) await db.exec(statement);
      }
      await db.run(`INSERT INTO "${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES (?, ?)`, [
        migration.hash,
        migration.when,
      ]);
      applied.push(migration.tag);
    }
  });
  return applied;
}
