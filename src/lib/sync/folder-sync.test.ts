/**
 * Folder sync between two devices, each with its own real, fully migrated
 * database and a shared in-memory "iCloud Drive" folder.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";

import { syncTime, syncWithFolder, type SyncFolder } from "@megan/core/sync/folder-sync";

import { betterSqliteDriver } from "../platform/sqlite";

function device(id: string) {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  return { sqlite, db: betterSqliteDriver(sqlite), info: { id, name: id } };
}

function folder() {
  const files = new Map<string, string>();
  let writes = 0;
  const io: SyncFolder = {
    async list() {
      return [...files.keys()];
    },
    async read(name) {
      return files.get(name) ?? null;
    },
    async write(name, text) {
      writes += 1;
      files.set(name, text);
    },
  };
  return { io, files, writes: () => writes };
}

const T0 = Date.UTC(2026, 9, 22, 12);

function seed(sqlite: Database.Database) {
  sqlite.exec(`
    INSERT INTO courses (id, title) VALUES ('c1', 'Biology');
    INSERT INTO exams (id, course_id, title) VALUES ('e1', 'c1', 'Midterm');
    INSERT INTO flashcards (id, exam_id, question, direct_answer, front_image_path)
      VALUES ('k1', 'e1', 'What is ATP?', 'Energy currency', '/Users/me/pic.png'),
             ('k2', 'e1', 'Mitosis?', 'Cell division', NULL);
    INSERT INTO study_progress (id, flashcard_id, state, interval_days, last_reviewed_at)
      VALUES ('p1', 'k1', 'retention', 6, '2026-10-20T10:00:00.000Z');
  `);
}

const cards = (sqlite: Database.Database) =>
  sqlite.prepare("SELECT id, question, starred, front_image_path FROM flashcards ORDER BY id").all();

describe("syncing decks through a shared folder", () => {
  it("reads SQLite's and JavaScript's time formats the same way", () => {
    expect(syncTime("2026-10-22 12:00:00")).toBe(T0);
    expect(syncTime("2026-10-22T12:00:00.000Z")).toBe(T0);
    expect(syncTime(null)).toBe(0);
  });

  it("brings a new device's library over, minus things only the first device has", async () => {
    const mac = device("mac");
    const phone = device("phone");
    const cloud = folder();
    seed(mac.sqlite);

    await syncWithFolder(mac.db, cloud.io, mac.info, T0);
    const result = await syncWithFolder(phone.db, cloud.io, phone.info, T0);

    expect(result).toMatchObject({ devices: 1, skipped: 0, sent: true });
    expect(result.received).toBe(5);
    expect(cards(phone.sqlite)).toEqual([
      { id: "k1", question: "What is ATP?", starred: 0, front_image_path: null },
      { id: "k2", question: "Mitosis?", starred: 0, front_image_path: null },
    ]);
    expect(phone.sqlite.prepare("SELECT flashcard_id, interval_days FROM study_progress").all()).toEqual([
      { flashcard_id: "k1", interval_days: 6 },
    ]);
    expect([...cloud.files.keys()].sort()).toEqual(["mac.json", "phone.json"]);
  });

  it("keeps the newest edit, both ways, and leaves local pictures alone", async () => {
    const mac = device("mac");
    const phone = device("phone");
    const cloud = folder();
    seed(mac.sqlite);
    await syncWithFolder(mac.db, cloud.io, mac.info, T0);
    await syncWithFolder(phone.db, cloud.io, phone.info, T0);

    // Star on the phone (touch trigger stamps it now), then sync it to the Mac.
    phone.sqlite.exec("UPDATE flashcards SET starred = 1 WHERE id = 'k1'");
    await syncWithFolder(phone.db, cloud.io, phone.info);
    await syncWithFolder(mac.db, cloud.io, mac.info);
    expect(cards(mac.sqlite)[0]).toEqual({
      id: "k1",
      question: "What is ATP?",
      starred: 1,
      front_image_path: "/Users/me/pic.png",
    });

    // An older edit on the Mac doesn't override it.
    mac.sqlite.exec("UPDATE flashcards SET starred = 0, updated_at = '2020-01-01T00:00:00.000Z' WHERE id = 'k1'");
    await syncWithFolder(phone.db, cloud.io, phone.info);
    expect(cards(phone.sqlite)[0]).toMatchObject({ starred: 1 });
  });

  it("carries deletes across, cascades included, and doesn't bring them back", async () => {
    const mac = device("mac");
    const phone = device("phone");
    const cloud = folder();
    seed(mac.sqlite);
    await syncWithFolder(mac.db, cloud.io, mac.info, T0);
    await syncWithFolder(phone.db, cloud.io, phone.info, T0);

    phone.sqlite.exec("DELETE FROM flashcards WHERE id = 'k2'");
    await syncWithFolder(phone.db, cloud.io, phone.info);
    await syncWithFolder(mac.db, cloud.io, mac.info);
    expect(cards(mac.sqlite).map((card) => (card as { id: string }).id)).toEqual(["k1"]);

    // The Mac's next file no longer has k2, and the phone doesn't revive it.
    await syncWithFolder(phone.db, cloud.io, phone.info);
    expect(cards(phone.sqlite).map((card) => (card as { id: string }).id)).toEqual(["k1"]);

    mac.sqlite.exec("DELETE FROM exams WHERE id = 'e1'");
    await syncWithFolder(mac.db, cloud.io, mac.info);
    await syncWithFolder(phone.db, cloud.io, phone.info);
    expect(cards(phone.sqlite)).toEqual([]);
    expect(phone.sqlite.prepare("SELECT count(*) AS n FROM study_progress").get()).toEqual({ n: 0 });
    expect(phone.sqlite.prepare("SELECT count(*) AS n FROM courses").get()).toEqual({ n: 1 });
  });

  it("merges libraries made separately and only rewrites its file when something changed", async () => {
    const mac = device("mac");
    const phone = device("phone");
    const cloud = folder();
    seed(mac.sqlite);
    phone.sqlite.exec(`
      INSERT INTO courses (id, title) VALUES ('c2', 'Chemistry');
      INSERT INTO exams (id, course_id, title) VALUES ('e2', 'c2', 'Quiz');
      INSERT INTO flashcards (id, exam_id, question, direct_answer) VALUES ('k9', 'e2', 'pH of water?', '7');
    `);

    await syncWithFolder(mac.db, cloud.io, mac.info, T0);
    await syncWithFolder(phone.db, cloud.io, phone.info, T0);
    await syncWithFolder(mac.db, cloud.io, mac.info, T0);
    expect(cards(mac.sqlite).map((card) => (card as { id: string }).id)).toEqual(["k1", "k2", "k9"]);
    expect(cards(phone.sqlite).map((card) => (card as { id: string }).id)).toEqual(["k1", "k2", "k9"]);

    const before = cloud.writes();
    const quiet = await syncWithFolder(mac.db, cloud.io, mac.info, T0);
    expect(quiet).toMatchObject({ received: 0, sent: false });
    expect(cloud.writes()).toBe(before);
  });

  it("ignores files that aren't sync files and waits on rows whose parent is missing", async () => {
    const phone = device("phone");
    const cloud = folder();
    cloud.files.set("notes.json", "{not json");
    cloud.files.set(
      "other.json",
      JSON.stringify({
        format: "megan-sync",
        version: 1,
        device: "other",
        deviceName: "other",
        writtenAt: "",
        tables: {
          flashcards: {
            rows: [{ id: "x1", exam_id: "nope", question: "Q", direct_answer: "A", created_at: "2026-10-22 10:00:00" }],
            deleted: {},
          },
        },
      }),
    );
    const result = await syncWithFolder(phone.db, cloud.io, phone.info, T0);
    expect(result).toMatchObject({ devices: 1, received: 0, skipped: 1 });
    expect(cards(phone.sqlite)).toEqual([]);
  });
});
