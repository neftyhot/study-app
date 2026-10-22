/**
 * The platform data layer: the shared migration runner the iOS app uses
 * must leave a database exactly as the desktop's startup migrator does, and
 * the two must recognise each other's bookkeeping.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";

import { bundleMigrations, MIGRATIONS_TABLE, runMigrations } from "@megan/core/platform/migrate";
import {
  developmentLicense,
  MemoryNotifier,
  MemorySecretStore,
  RecordingHaptics,
} from "@megan/core/platform/memory";
import { DESKTOP_ONLY_FEATURES } from "@megan/core/platform/types";

import { betterSqliteDriver } from "./sqlite";

const FOLDER = "./drizzle";

function bundled() {
  const journal = JSON.parse(fs.readFileSync(path.join(FOLDER, "meta", "_journal.json"), "utf8"));
  return bundleMigrations(
    journal,
    (tag) => fs.readFileSync(path.join(FOLDER, `${tag}.sql`), "utf8"),
    (text) => createHash("sha256").update(text).digest("hex"),
  );
}

function schemaOf(sqlite: Database.Database) {
  return sqlite
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all();
}

function bookkeeping(sqlite: Database.Database) {
  return sqlite.prepare(`SELECT hash, created_at FROM "${MIGRATIONS_TABLE}" ORDER BY created_at`).all();
}

describe("shared migration runner", () => {
  it("builds the same schema and bookkeeping as drizzle's migrator", async () => {
    const viaDrizzle = new Database(":memory:");
    migrate(drizzle(viaDrizzle), { migrationsFolder: FOLDER });

    const viaCore = new Database(":memory:");
    const applied = await runMigrations(betterSqliteDriver(viaCore), bundled());

    expect(applied).toHaveLength(bundled().length);
    expect(schemaOf(viaCore)).toEqual(schemaOf(viaDrizzle));
    expect(bookkeeping(viaCore)).toEqual(bookkeeping(viaDrizzle));
  });

  it("applies nothing the second time, or after drizzle has run", async () => {
    const sqlite = new Database(":memory:");
    migrate(drizzle(sqlite), { migrationsFolder: FOLDER });
    sqlite.exec("INSERT INTO courses (id, title) VALUES ('c1', 'Chem')");

    const driver = betterSqliteDriver(sqlite);
    expect(await runMigrations(driver, bundled())).toEqual([]);
    expect(await runMigrations(driver, bundled())).toEqual([]);
    expect(sqlite.prepare("SELECT count(*) AS n FROM courses").get()).toEqual({ n: 1 });
  });

  it("leaves drizzle nothing to do after it has run", async () => {
    const sqlite = new Database(":memory:");
    await runMigrations(betterSqliteDriver(sqlite), bundled());
    const before = bookkeeping(sqlite);
    migrate(drizzle(sqlite), { migrationsFolder: FOLDER });
    expect(bookkeeping(sqlite)).toEqual(before);
  });

  it("upgrades an older database without losing its rows", async () => {
    const all = bundled();
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const driver = betterSqliteDriver(sqlite);
    const cut = all.findIndex((m) => m.tag === "0031_sync_ready");
    expect(cut).toBeGreaterThan(0);
    await runMigrations(driver, all.slice(0, cut));
    sqlite.exec(`
      INSERT INTO courses (id, title) VALUES ('c1', 'Biology');
      INSERT INTO exams (id, course_id, title) VALUES ('e1', 'c1', 'Midterm');
      INSERT INTO flashcards (id, exam_id, question, direct_answer) VALUES ('k1', 'e1', 'Q', 'A');
      INSERT INTO study_progress (id, flashcard_id, state) VALUES ('p1', 'k1', 'review');
    `);

    const applied = await runMigrations(driver, all);
    expect(applied[0]).toBe("0031_sync_ready");
    expect(sqlite.prepare("SELECT question FROM flashcards").get()).toEqual({ question: "Q" });
    expect(sqlite.prepare("SELECT state FROM study_progress").get()).toEqual({ state: "review" });
  });

  it("rolls the whole run back when a statement fails", async () => {
    const sqlite = new Database(":memory:");
    const broken = [
      ...bundled().slice(0, 2),
      { tag: "9999_broken", when: Date.now(), hash: "x", statements: ["CREATE TABLE nope (", ""] },
    ];
    await expect(runMigrations(betterSqliteDriver(sqlite), broken)).rejects.toThrow();
    expect(bookkeeping(sqlite)).toEqual([]);
    expect(sqlite.inTransaction).toBe(false);
  });
});

describe("desktop SQLite driver", () => {
  it("runs, queries and commits", async () => {
    const driver = betterSqliteDriver(new Database(":memory:"));
    await driver.exec("CREATE TABLE t (n integer)");
    expect(await driver.run("INSERT INTO t VALUES (?), (?)", [1, 2])).toEqual({ changes: 2 });
    await driver.transaction(() => driver.run("INSERT INTO t VALUES (?)", [3]));
    expect(await driver.all("SELECT n FROM t ORDER BY n")).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("rolls back a transaction that throws", async () => {
    const driver = betterSqliteDriver(new Database(":memory:"));
    await driver.exec("CREATE TABLE t (n integer)");
    await expect(
      driver.transaction(async () => {
        await driver.run("INSERT INTO t VALUES (1)");
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
    expect(await driver.all("SELECT n FROM t")).toEqual([]);
  });
});

describe("in-memory adapters", () => {
  it("stores and forgets secrets", async () => {
    const secrets = new MemorySecretStore();
    await secrets.set("gemini_api_key", "abc");
    expect(await secrets.get("gemini_api_key")).toBe("abc");
    await secrets.delete("gemini_api_key");
    expect(await secrets.get("gemini_api_key")).toBeNull();
  });

  it("replaces a reminder scheduled under the same id", async () => {
    const notifier = new MemoryNotifier();
    const at = new Date("2026-11-01T09:00:00Z");
    await notifier.schedule([{ id: 1, title: "Study", body: "5 due", at }]);
    await notifier.schedule([{ id: 1, title: "Study", body: "8 due", at }]);
    expect([...notifier.scheduled.values()].map((r) => r.body)).toEqual(["8 due"]);
    await notifier.cancel([1]);
    expect(notifier.scheduled.size).toBe(0);
  });

  it("records taps and grants full access in development", async () => {
    const haptics = new RecordingHaptics();
    await haptics.impact("tap");
    expect(haptics.taps).toEqual(["tap"]);
    expect(await developmentLicense.access()).toEqual({ full: true, source: "development" });
  });

  it("lists every deferred iOS feature once", () => {
    const ids = DESKTOP_ONLY_FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining(["lectures", "local-ai", "libreoffice", "occlusion", "bulk-edit", "catalog-publish"]),
    );
  });
});
