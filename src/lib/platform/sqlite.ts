import type Database from "better-sqlite3";

import type { SqlDriver, SqlValue } from "@megan/core/platform/types";

/**
 * The desktop's SQLite behind the same small interface the iOS app's
 * Capacitor plugin implements, so shared code (the migration runner first)
 * runs unchanged on both. better-sqlite3 is synchronous; the promises are
 * only there to match the plugin.
 */
export function betterSqliteDriver(sqlite: Database.Database): SqlDriver {
  const driver: SqlDriver = {
    async exec(sql) {
      sqlite.exec(sql);
    },
    async run(sql, params = []) {
      const { changes } = sqlite.prepare(sql).run(...(params as unknown[]));
      return { changes };
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return sqlite.prepare(sql).all(...(params as unknown[])) as T[];
    },
    async transaction<T>(work: () => Promise<T>) {
      // better-sqlite3's own transaction() cannot wrap async work, so this
      // opens and closes it by hand.
      sqlite.exec("BEGIN");
      try {
        const result = await work();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return driver;
}
