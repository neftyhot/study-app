/**
 * An existing install upgrades in place: the startup migrator runs on a
 * database that already has rows, so every new migration must keep them.
 *
 * Builds a database as it stood before the newest migration (by migrating
 * from a copy of `drizzle/` whose journal stops one short), fills it with
 * raw SQL the way an old build would have, then runs the real folder.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";

const FOLDER = "./drizzle";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "megan-migrations-"));

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A copy of the migrations folder whose journal ends before `tag`. */
function folderBefore(tag: string) {
  const dir = path.join(tmp, tag);
  fs.cpSync(FOLDER, dir, { recursive: true });
  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const at = journal.entries.findIndex((e: { tag: string }) => e.tag === tag);
  expect(at).toBeGreaterThan(0);
  journal.entries = journal.entries.slice(0, at);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

function columns(sqlite: Database.Database, table: string) {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

describe("upgrading an existing database", () => {
  it("adds the sync-ready columns without losing rows (0031)", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: folderBefore("0031_sync_ready") });

    expect(columns(sqlite, "courses")).not.toContain("deleted_at");

    sqlite.exec(`
      INSERT INTO courses (id, title, created_at) VALUES ('c1', 'Biology', '2026-01-02 03:04:05');
      INSERT INTO exams (id, course_id, title, created_at) VALUES ('e1', 'c1', 'Midterm', '2026-01-03 00:00:00');
      INSERT INTO source_files (id, exam_id, filename, file_type, role, raw_path, status, created_at)
        VALUES ('f1', 'e1', 'notes.txt', 'pasted', 'notes', 'x', 'ready', '2026-01-04 00:00:00');
      INSERT INTO flashcards (id, exam_id, question, direct_answer) VALUES ('k1', 'e1', 'Q', 'A');
      INSERT INTO study_progress (id, flashcard_id, state, last_reviewed_at)
        VALUES ('p1', 'k1', 'learning', '2026-01-05T00:00:00.000Z');
    `);

    migrate(db, { migrationsFolder: FOLDER });

    for (const table of ["courses", "exams", "source_files", "study_guide_objectives", "study_progress"]) {
      expect(columns(sqlite, table)).toEqual(expect.arrayContaining(["updated_at", "deleted_at"]));
    }
    for (const table of ["flashcards", "diagram_occlusions"]) {
      expect(columns(sqlite, table)).toContain("deleted_at");
    }

    const course = sqlite.prepare("SELECT * FROM courses WHERE id = 'c1'").get() as Record<string, unknown>;
    expect(course).toMatchObject({ title: "Biology", updated_at: "2026-01-02 03:04:05", deleted_at: null });
    const exam = sqlite.prepare("SELECT updated_at FROM exams WHERE id = 'e1'").get();
    expect(exam).toEqual({ updated_at: "2026-01-03 00:00:00" });
    const progress = sqlite.prepare("SELECT state, updated_at FROM study_progress WHERE id = 'p1'").get();
    expect(progress).toEqual({ state: "learning", updated_at: "2026-01-05T00:00:00.000Z" });
    // "Never edited" stays a fact on cards: not backfilled.
    const card = sqlite.prepare("SELECT question, updated_at, deleted_at FROM flashcards WHERE id = 'k1'").get();
    expect(card).toEqual({ question: "Q", updated_at: null, deleted_at: null });
  });

  it("adds the scan marker to existing cards as false (0032)", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: folderBefore("0032_scanned_cards") });

    sqlite.exec(`
      INSERT INTO courses (id, title) VALUES ('c1', 'Biology');
      INSERT INTO exams (id, course_id, title) VALUES ('e1', 'c1', 'Midterm');
      INSERT INTO flashcards (id, exam_id, question, direct_answer) VALUES ('k1', 'e1', 'Q', 'A');
    `);

    migrate(db, { migrationsFolder: FOLDER });

    const card = sqlite.prepare("SELECT question, from_scan FROM flashcards WHERE id = 'k1'").get();
    expect(card).toEqual({ question: "Q", from_scan: 0 });
  });

  it("keeps a last-release library whole: cards, stars, progress and history", () => {
    // The shipped app stopped at 0030; every migration since is this branch's.
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: folderBefore("0031_sync_ready") });

    sqlite.exec(`
      INSERT INTO courses (id, title) VALUES ('c1', 'US History');
      INSERT INTO exams (id, course_id, title) VALUES ('e1', 'c1', 'Unit 4');
      INSERT INTO flashcards (id, exam_id, question, direct_answer, starred)
        VALUES ('k1', 'e1', 'Roosevelt Corollary?', 'US may police the hemisphere', 1),
               ('k2', 'e1', 'Open Door Policy?', 'Equal trade access to China', 0);
      INSERT INTO study_progress (id, flashcard_id, state, interval_days, next_review_due, ease, lapses, last_reviewed_at)
        VALUES ('p1', 'k1', 'retention', 12, '2026-11-01', 2.5, 1, '2026-10-20T10:00:00.000Z');
      INSERT INTO study_sessions (id, exam_id, mode, card_grades, missed_count, easy_count)
        VALUES ('s1', 'e1', 'flashcards', '{"k1":"easy","k2":"missed"}', 1, 1);
      INSERT INTO answer_attempts (id, flashcard_id, session_id, answer, verdict, counts_toward_mastery)
        VALUES ('a1', 'k1', 's1', 'police power', 'correct', 1);
      INSERT INTO card_revisions (id, flashcard_id, question, direct_answer)
        VALUES ('r1', 'k1', 'Old question', 'Old answer');
      INSERT INTO app_settings (key, value) VALUES ('theme', '"dark"');
    `);

    migrate(db, { migrationsFolder: FOLDER });

    // Read back through today's schema, the way the app does.
    const cards = db.select().from(schema.flashcards).all();
    expect(cards.map((c) => [c.id, c.starred, c.fromScan, c.deletedAt])).toEqual([
      ["k1", true, false, null],
      ["k2", false, false, null],
    ]);
    const progress = db.select().from(schema.studyProgress).get();
    expect(progress).toMatchObject({ state: "retention", intervalDays: 12, nextReviewDue: "2026-11-01", ease: 2.5, lapses: 1 });
    const session = db.select().from(schema.studySessions).get();
    expect(session).toMatchObject({ cardGrades: { k1: "easy", k2: "missed" }, missedCount: 1, easyCount: 1 });
    expect(db.select().from(schema.answerAttempts).get()).toMatchObject({ sessionId: "s1", verdict: "correct", countsTowardMastery: true });
    expect(db.select().from(schema.cardRevisions).get()).toMatchObject({ question: "Old question" });
    expect(db.select().from(schema.appSettings).get()).toMatchObject({ key: "theme", value: '"dark"' });
  });

  it("is a no-op the second time (startup runs it on every launch)", () => {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: FOLDER });
    sqlite.exec("INSERT INTO courses (id, title) VALUES ('c1', 'Chem')");
    migrate(db, { migrationsFolder: FOLDER });
    expect(sqlite.prepare("SELECT count(*) AS n FROM courses").get()).toEqual({ n: 1 });
  });
});
