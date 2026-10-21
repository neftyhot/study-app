import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { backupBeforeUpdate, backupDatabase } = require("../../electron/backup.cjs") as {
  backupBeforeUpdate: (dbPath: string, version: string) => Promise<string | null>;
  backupDatabase: (sqlite: Database.Database, dbPath: string, now?: Date) => Promise<string | null>;
};

const dirs: string[] = [];
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
  dirs.push(dir);
  const file = path.join(dir, "study-app.db");
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec("create table notes (body text); insert into notes values ('kept')");
  return { dir, file, db };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("the copy taken before an update", () => {
  it("copies the database while it is open, named for the version left", async () => {
    const { dir, file, db } = fixture();
    const target = await backupBeforeUpdate(file, "1.4.2");
    expect(target).toBe(path.join(dir, "backups", "before-update-1.4.2.db"));
    const copy = new Database(target!, { readonly: true });
    expect(copy.prepare("select body from notes").get()).toEqual({ body: "kept" });
    copy.close();
    db.close();
  });

  it("keeps the last three, and leaves the daily copies alone", async () => {
    const { dir, file, db } = fixture();
    await backupDatabase(db, file, new Date(2026, 9, 1));
    for (const version of ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]) {
      await backupBeforeUpdate(file, version);
      // Distinct modification times, oldest first.
      const t = new Date(2026, 0, Number(version.split(".")[1]) + 1);
      fs.utimesSync(path.join(dir, "backups", `before-update-${version}.db`), t, t);
    }
    const names = fs.readdirSync(path.join(dir, "backups")).sort();
    expect(names).toEqual([
      "before-update-1.1.0.db",
      "before-update-1.2.0.db",
      "before-update-1.3.0.db",
      "study-app-2026-10-01.db",
    ]);
    db.close();
  });

  it("does nothing, without throwing, when there is no database", async () => {
    expect(await backupBeforeUpdate("/nonexistent/study-app.db", "1.0.0")).toBeNull();
  });
});
