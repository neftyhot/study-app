/** The iPhone side of folder sync: a fresh phone picks up the Mac's library. */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";

import { syncWithFolder, type SyncFolder } from "@megan/core/sync/folder-sync";

import { betterSqliteDriver } from "@/lib/platform/sqlite";
import { readSyncStatus, runSync, setSyncFolder } from "./sync";

function database() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  return { sqlite, db: betterSqliteDriver(sqlite) };
}

function folder(): SyncFolder & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async list() {
      return [...files.keys()];
    },
    async read(name) {
      return files.get(name) ?? null;
    },
    async write(name, text) {
      files.set(name, text);
    },
  };
}

describe("syncing the iPhone", () => {
  it("does nothing until a folder is chosen, then brings the Mac's decks over", async () => {
    const mac = database();
    const phone = database();
    const cloud = folder();
    mac.sqlite.exec(`
      INSERT INTO courses (id, title) VALUES ('c1', 'Biology');
      INSERT INTO exams (id, course_id, title) VALUES ('e1', 'c1', 'Midterm');
      INSERT INTO flashcards (id, exam_id, question, direct_answer) VALUES ('k1', 'e1', 'ATP?', 'Energy');
    `);
    await syncWithFolder(mac.db, cloud, { id: "mac-1", name: "Mac" });

    expect(await runSync(phone.db, cloud)).toBeNull();
    expect(cloud.files.size).toBe(1);

    await setSyncFolder(phone.db, "Megan Study Sync");
    const [first, second] = await Promise.all([runSync(phone.db, cloud), runSync(phone.db, cloud)]);
    expect(first).toBe(second);
    expect(first).toMatchObject({ received: 3, devices: 1 });
    expect(phone.sqlite.prepare("SELECT question FROM flashcards").all()).toEqual([{ question: "ATP?" }]);
    expect([...cloud.files.keys()].some((name) => name.startsWith("iphone-"))).toBe(true);
    expect((await readSyncStatus(phone.db)).lastSyncedAt).not.toBeNull();

    await setSyncFolder(phone.db, null);
    expect(await readSyncStatus(phone.db)).toEqual({ folder: null, lastSyncedAt: null });
  });
});
