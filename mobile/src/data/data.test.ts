/**
 * The iOS data layer against a real SQLite database, migrated by the shared
 * runner from the desktop's own `drizzle/` folder. Where iOS mirrors a desktop
 * write (a deck, a scan), the rows are compared with what the desktop wrote.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { insertDeck as desktopInsertDeck } from "@/lib/decks/insert";
import { buildShareFile as desktopBuildShareFile } from "@/lib/share/meganstudy";
import { betterSqliteDriver } from "@/lib/platform/sqlite";
import { createManualCards as desktopCreateManualCards } from "@/lib/cards/manual";
import { saveScanCards as desktopSaveScanCards } from "@/lib/scan/scan";
import { bundleMigrations } from "@megan/core/platform/migrate";
import type { Notifier, SqlDriver } from "@megan/core/platform/types";
import { SAMPLE_DECK } from "@megan/core/sample/memory-deck";
import { parseShareFile, SHARE_FORMAT, SHARE_VERSION } from "@megan/core/share/meganstudy";
import { todayIso } from "@megan/core/srs/schedule";

import { catalogClient, filterDecks, readCollege, writeCollege, type Http, type HttpRequest } from "./catalog";
import { loadCards, loadDueCards, loadStarred, recordFlip, recordLearn, setStarred, undoGrade } from "./cards";
import { prepareDatabase } from "./db";
import { countAllDue, deleteDeck, listCourses } from "./decks";
import { buildShareFile } from "./export";
import { citationLabel, loadGuide } from "./guides";
import { importShareFile, insertDeck } from "./import";
import {
  createLecture,
  defaultLectureTitle,
  deleteLecture,
  getLecture,
  listLectures,
  renameLecture,
  saveTranscript,
} from "./lectures";
import { planReminders, readReminders, rescheduleReminders, writeReminders } from "./reminders";
import { ensureSampleDeck, findSampleDeck } from "./sample";
import { saveTypedCards } from "./make";
import { createNotesDeck, createScanDeck, saveExtractedCards, saveScanCards } from "./scan";
import { searchCards } from "./search";
import { readSetting, writeSetting } from "./settings";

const DRIZZLE = resolve(__dirname, "../../../drizzle");
const MIGRATIONS = bundleMigrations(
  JSON.parse(readFileSync(resolve(DRIZZLE, "meta/_journal.json"), "utf8")),
  (tag) => readFileSync(resolve(DRIZZLE, `${tag}.sql`), "utf8"),
  (text) => createHash("sha256").update(text).digest("hex"),
);

let sqlite: Database.Database;
let db: SqlDriver;

beforeEach(async () => {
  sqlite = new Database(":memory:");
  db = betterSqliteDriver(sqlite);
  await prepareDatabase(db, MIGRATIONS);
});

function desktopDb(): { raw: Database.Database; db: Db } {
  const raw = new Database(":memory:");
  const d = drizzle(raw, { schema }) as unknown as Db;
  migrate(d, { migrationsFolder: DRIZZLE });
  return { raw, db: d };
}

const TODAY = todayIso();

describe("opening the database", () => {
  it("builds the desktop's schema", () => {
    const desktop = desktopDb().raw;
    const tables = (s: Database.Database) =>
      s
        .prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all();
    expect(tables(sqlite)).toEqual(tables(desktop));
  });

  it("applies nothing to a database the desktop already migrated, and keeps its cards", async () => {
    const { raw, db: d } = desktopDb();
    desktopInsertDeck(d, SAMPLE_DECK);
    const applied = await prepareDatabase(betterSqliteDriver(raw), MIGRATIONS);
    expect(applied).toEqual([]);
    expect((raw.prepare("SELECT count(*) AS n FROM flashcards").get() as { n: number }).n).toBe(SAMPLE_DECK.cards.length);
  });

  it("enforces foreign keys, so deleting a deck cascades", async () => {
    const examId = await insertDeck(db, SAMPLE_DECK);
    await recordFlip(db, (await loadCards(db, examId))[0].id, "easy");
    await deleteDeck(db, examId);
    for (const table of ["flashcards", "card_rubrics", "study_progress", "primer_guides", "primer_sections", "courses"]) {
      expect((sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n, table).toBe(0);
    }
  });
});

describe("adding a deck", () => {
  const strip = (rows: Record<string, unknown>[]) =>
    rows.map((row) => {
      const copy: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (key === "id" || key.endsWith("_id") || key.endsWith("_at")) continue;
        copy[key] = value;
      }
      return copy;
    });

  it("writes the same rows as the desktop", async () => {
    await insertDeck(db, SAMPLE_DECK);
    const desktop = desktopDb();
    desktopInsertDeck(desktop.db, SAMPLE_DECK);
    for (const [table, order] of [
      ["flashcards", "question"],
      ["card_rubrics", "essential_points"],
      ["primer_guides", "model"],
      ["primer_topics", "order_index"],
      ["primer_sections", "order_index"],
      ["courses", "title"],
      ["exams", "title"],
    ]) {
      const query = `SELECT * FROM ${table} ORDER BY ${order}`;
      expect(strip(sqlite.prepare(query).all() as Record<string, unknown>[]), table).toEqual(
        strip(desktop.raw.prepare(query).all() as Record<string, unknown>[]),
      );
    }
  });

  it("opens a .meganstudy file", async () => {
    const { origin: _origin, ...deck } = { ...SAMPLE_DECK, title: "Shared", course: "Bio" };
    void _origin;
    const raw = JSON.stringify({ format: SHARE_FORMAT, version: SHARE_VERSION, exportedAt: new Date().toISOString(), deck });
    const result = await importShareFile(db, raw);
    expect(result.cards).toBe(SAMPLE_DECK.cards.length);
    const [course] = await listCourses(db);
    expect(course.title).toBe("Bio");
    expect(course.decks[0].title).toBe("Shared");
  });

  it("shares a deck exactly as the desktop does, and the file opens again", async () => {
    const examId = await insertDeck(db, SAMPLE_DECK);
    const desktop = desktopDb();
    const desktopId = desktopInsertDeck(desktop.db, SAMPLE_DECK);
    const now = new Date("2026-01-01T00:00:00Z");
    for (const includeGuide of [false, true]) {
      const file = await buildShareFile(db, examId, { includeGuide }, now);
      expect(file).toEqual(desktopBuildShareFile(desktop.db, desktopId, { includeGuide }, now));
      expect(parseShareFile(JSON.stringify(file))).toMatchObject(file!);
    }
    const again = await importShareFile(db, JSON.stringify(await buildShareFile(db, examId, { includeGuide: true }, now)));
    expect(again.cards).toBe(SAMPLE_DECK.cards.length);
    expect(await buildShareFile(db, "missing")).toBeNull();
  });

  it("reuses the sample deck and re-adds it after a delete", async () => {
    expect(await findSampleDeck(db)).toBeNull();
    const first = await ensureSampleDeck(db);
    expect(await ensureSampleDeck(db)).toBe(first);
    await deleteDeck(db, first);
    const again = await ensureSampleDeck(db);
    expect(again).not.toBe(first);
  });
});

describe("studying", () => {
  it("loads cards with rubrics, in teaching order", async () => {
    const examId = await insertDeck(db, SAMPLE_DECK);
    const cards = await loadCards(db, examId);
    expect(cards).toHaveLength(SAMPLE_DECK.cards.length);
    expect(cards[0].essentialPoints.length).toBeGreaterThan(0);
    expect(cards[0].progress).toBeUndefined();
  });

  it("stars a card and lists it", async () => {
    const examId = await insertDeck(db, SAMPLE_DECK);
    const [card] = await loadCards(db, examId);
    await setStarred(db, card.id, true);
    expect((await loadStarred(db)).map((c) => c.id)).toEqual([card.id]);
    expect((await listCourses(db))[0].decks[0].starredCount).toBe(1);
  });

  it("schedules a swipe exactly as the desktop would, and undoes it", async () => {
    const examId = await insertDeck(db, SAMPLE_DECK);
    const [card] = await loadCards(db, examId);

    const undo = await recordFlip(db, card.id, "easy");
    const after = (await loadCards(db, examId))[0].progress!;
    expect(after.state).toBe("recognition");
    expect(after.recognitionCount).toBe(1);
    expect(after.nextReviewDue).not.toBeNull();

    await undoGrade(db, undo);
    expect((await loadCards(db, examId))[0].progress).toBeUndefined();
  });

  it("undoes a second grade back to the first", async () => {
    const examId = await insertDeck(db, SAMPLE_DECK);
    const [card] = await loadCards(db, examId);
    await recordFlip(db, card.id, "easy");
    const first = (await loadCards(db, examId))[0].progress!;
    const undo = await recordFlip(db, card.id, "missed");
    expect((await loadCards(db, examId))[0].progress!.lapses).toBe(1);
    await undoGrade(db, undo);
    const restored = (await loadCards(db, examId))[0].progress!;
    expect({ ...restored, updatedAt: null }).toEqual({ ...first, updatedAt: null });
  });

  it("records a Learn answer", async () => {
    const examId = await insertDeck(db, SAMPLE_DECK);
    const [card] = await loadCards(db, examId);
    await recordLearn(db, card.id, { stage: "mcq", countsTowardMastery: true }, { correct: true, verdict: "correct" }, "longterm");
    expect((await loadCards(db, examId))[0].progress!.state).toBe("recognition");
  });

  it("counts what is due", async () => {
    const examId = await insertDeck(db, SAMPLE_DECK);
    const [card] = await loadCards(db, examId);
    await recordFlip(db, card.id, "easy");
    sqlite.prepare("UPDATE study_progress SET next_review_due = ?").run(TODAY);
    expect(await countAllDue(db, TODAY)).toBe(1);
    expect((await loadDueCards(db, TODAY)).map((due) => due.id)).toEqual([card.id]);
    const deck = (await listCourses(db, TODAY))[0].decks[0];
    expect(deck.dueCount).toBe(1);
    expect(deck.newCount).toBe(SAMPLE_DECK.cards.length - 1);
    expect(deck.hasGuide).toBe(true);
  });
});

describe("the study guide", () => {
  it("loads topics and sections with their sentences", async () => {
    const examId = await insertDeck(db, SAMPLE_DECK);
    const guide = (await loadGuide(db, examId))!;
    expect(guide.topics.map((t) => t.title)).toEqual(SAMPLE_DECK.guide!.topics.map((t) => t.title));
    expect(guide.topics[0].sections[0].definition[0].text).toBe(SAMPLE_DECK.guide!.topics[0].sections[0].definition[0]);
  });

  it("labels a citation like the desktop", () => {
    const base = { text: "x", source_excerpt: null };
    expect(citationLabel({ ...base, source_document_index: 2, source_slide_number: 14 })).toBe("Slideshow 2 · Slide 14");
    expect(citationLabel({ ...base, source_document_index: null, source_slide_number: null })).toBeNull();
  });
});

describe("search", () => {
  it("finds a card by its answer", async () => {
    await insertDeck(db, SAMPLE_DECK);
    const target = SAMPLE_DECK.cards[3];
    const hits = await searchCards(db, target.question);
    expect(hits[0].question).toBe(target.question);
    expect(await searchCards(db, "   ")).toEqual([]);
  });
});

describe("snap your notes", () => {
  it("saves cards the way the desktop does", async () => {
    const cards = [
      { topic: "Cells", question: "What makes ATP?", directAnswer: "Mitochondria", essentialPoints: ["mitochondria"], fromMaterial: true },
      { topic: "Cells", question: "Who saw cells?", directAnswer: "Hooke", essentialPoints: ["Hooke"], fromMaterial: false, commonMisconceptions: ["Darwin"] },
    ];
    const examId = await createScanDeck(db, "Bio notes");
    expect(await saveScanCards(db, examId, cards)).toBe(2);

    const desktop = desktopDb();
    const desktopExam = desktopInsertDeck(desktop.db, { ...SAMPLE_DECK, cards: SAMPLE_DECK.cards.slice(0, 1) });
    desktopSaveScanCards(desktop.db, desktopExam, cards);

    const query =
      "SELECT f.topic, f.question, f.direct_answer, f.full_explanation, f.card_type, f.source_excerpt, f.has_ai_supplement, f.from_scan, r.essential_points, r.optional_points, r.common_misconceptions FROM flashcards f JOIN card_rubrics r ON r.flashcard_id = f.id WHERE f.from_scan = 1 ORDER BY f.question";
    expect(sqlite.prepare(query).all()).toEqual(desktop.raw.prepare(query).all());
  });
});

describe("make a deck", () => {
  it("saves typed cards the way the desktop's card-set editor does", async () => {
    const cards = [
      { front: "Capital of France", back: "Paris" },
      { front: "  half filled ", back: "" },
      { front: "Largest planet", back: " Jupiter " },
    ];
    const examId = await createNotesDeck(db, "  ", "My cards");
    expect(await saveTypedCards(db, examId, cards)).toBe(2);
    expect(sqlite.prepare("SELECT title FROM exams WHERE id = ?").get(examId)).toEqual({ title: "My cards" });

    const desktop = desktopDb();
    const desktopExam = desktopInsertDeck(desktop.db, { ...SAMPLE_DECK, cards: SAMPLE_DECK.cards.slice(0, 1) });
    desktopCreateManualCards(
      desktop.db,
      desktopExam,
      cards.filter((card) => card.back).map((card) => ({ question: card.front, directAnswer: card.back })),
    );

    const query =
      "SELECT f.topic, f.question, f.direct_answer, f.full_explanation, f.card_type, f.source_excerpt, f.has_ai_supplement, f.is_user_edited, f.from_scan, r.essential_points, r.optional_points, r.common_misconceptions FROM flashcards f JOIN card_rubrics r ON r.flashcard_id = f.id WHERE f.exam_id = ? AND f.is_user_edited = 1 ORDER BY f.question";
    expect(sqlite.prepare(query).all(examId)).toEqual(desktop.raw.prepare(query).all(desktopExam));
  });

  it("marks AI cards from a file as not scanned", async () => {
    const examId = await createNotesDeck(db, "Lecture 3", "Notes");
    await saveExtractedCards(db, examId, [{ question: "Q", directAnswer: "A", essentialPoints: ["A"], fromMaterial: true }], false);
    expect(sqlite.prepare("SELECT from_scan, has_ai_supplement FROM flashcards WHERE exam_id = ?").get(examId)).toEqual({
      from_scan: 0,
      has_ai_supplement: 0,
    });
  });
});

describe("settings and reminders", () => {
  it("stores and clears a setting", async () => {
    await writeSetting(db, "k", "v");
    expect(await readSetting(db, "k")).toBe("v");
    await writeSetting(db, "k", "  ");
    expect(await readSetting(db, "k")).toBeNull();
  });

  it("plans one reminder per day with cards due, and none when off", async () => {
    const examId = await insertDeck(db, SAMPLE_DECK);
    const cards = await loadCards(db, examId);
    await recordFlip(db, cards[0].id, "missed");
    await recordFlip(db, cards[1].id, "missed");
    sqlite.prepare("UPDATE study_progress SET next_review_due = ?").run(TODAY);

    expect(await readReminders(db)).toEqual({ enabled: false, time: "18:00" });
    const morning = new Date();
    morning.setHours(6, 0, 0, 0);
    expect(await planReminders(db, await readReminders(db), morning)).toEqual([]);

    const settings = await writeReminders(db, { enabled: true, time: "18:00" });
    const planned = await planReminders(db, settings, morning);
    expect(planned).toHaveLength(7);
    expect(planned[0].body).toBe("2 cards are due today.");
    expect(planned[0].at.getHours()).toBe(18);
    expect(new Set(planned.map((r) => r.id)).size).toBe(7);

    const evening = new Date();
    evening.setHours(20, 0, 0, 0);
    expect((await planReminders(db, settings, evening))[0].at.getDate()).not.toBe(evening.getDate());
  });

  it("cancels before scheduling, so reminders never stack", async () => {
    const notifier: Notifier = { requestPermission: vi.fn(), schedule: vi.fn(), cancel: vi.fn() };
    await writeReminders(db, { enabled: true, time: "18:00" });
    await rescheduleReminders(db, notifier);
    expect(notifier.cancel).toHaveBeenCalledTimes(1);
    // Nothing due: nothing scheduled.
    expect(notifier.schedule).not.toHaveBeenCalled();
  });
});

describe("the shared catalog", () => {
  const DETAILS = {
    title: "Unit 1",
    college: "State",
    professor: "Dr. Lee",
    course: "BIO 101",
    kind: "exam" as const,
    customKind: null,
    term: null,
    description: null,
  };

  function fakeServer(reply: (request: HttpRequest) => { status: number; data: unknown }) {
    const requests: HttpRequest[] = [];
    const http: Http = async (request) => {
      requests.push(request);
      return reply(request);
    };
    return { requests, client: catalogClient(db, http, "https://server.test") };
  }

  it("lists with this install's id, and says so when offline", async () => {
    const { requests, client } = fakeServer(() => ({ status: 200, data: { decks: [] } }));
    expect(await client.list()).toEqual({ decks: [], offline: null });
    const id = await readSetting(db, "install_id");
    expect(id).toBeTruthy();
    expect(requests[0]).toMatchObject({ url: "https://server.test/catalog", method: "GET", headers: { "X-Install-Id": id } });

    const offline = catalogClient(db, async () => {
      throw new Error("no network");
    }, "https://server.test");
    expect((await offline.list()).offline).toMatch(/Can't reach the catalog/);
    expect(catalogClient(db, async () => ({ status: 200, data: {} }), "").available).toBe(false);
  });

  it("adds a shared deck as a deck of the student's own", async () => {
    const { client } = fakeServer(() => ({
      status: 200,
      data: { title: "Cells", course: "BIO 101", term: null, cards: SAMPLE_DECK.cards, guide: null },
    }));
    const examId = await client.add("abc");
    const [course] = await listCourses(db);
    expect(course.title).toBe("BIO 101");
    expect(course.decks[0]).toMatchObject({ examId, title: "Cells", cardCount: SAMPLE_DECK.cards.length });
  });

  it("shares a deck with its cards and the student's key, and refuses without one", async () => {
    const examId = await insertDeck(db, SAMPLE_DECK);
    const { requests, client } = fakeServer(() => ({ status: 200, data: { id: "new" } }));
    const input = { ...DETAILS, examId, uploader: null, includeGuide: false, attested: true };
    await expect(client.publish(input, null)).rejects.toThrow(/AI key/);
    await expect(client.publish({ ...input, attested: false }, "k")).rejects.toThrow(/made these cards/);
    await expect(client.publish({ ...input, professor: " " }, "k")).rejects.toThrow(/professor/);
    expect(requests).toHaveLength(0);

    await client.publish(input, "k");
    const body = requests[0].body as Record<string, unknown>;
    expect(requests[0].method).toBe("POST");
    expect(body).toMatchObject({ title: "Unit 1", uploader: "A student", guide: null, moderation: { provider: "gemini", key: "k" } });
    expect((body.cards as unknown[]).length).toBe(SAMPLE_DECK.cards.length);
  });

  it("shows the server's error", async () => {
    const { client } = fakeServer(() => ({ status: 403, data: { error: "Not yours." } }));
    await expect(client.remove("x")).rejects.toThrow("Not yours.");
  });

  it("remembers the college and filters by it, by words and by owner", async () => {
    expect(await readCollege(db)).toBeNull();
    expect(await writeCollege(db, "  Ohio   State ")).toBe("Ohio State");
    expect(await readCollege(db)).toBe("Ohio State");
    const deck = (over: Record<string, unknown>) =>
      ({ ...DETAILS, id: "1", uploader: "", cardCount: 1, sectionCount: 0, adds: 0, status: "live", sourceExamId: null, createdAt: "", mine: false, ...over }) as Parameters<typeof filterDecks>[0][number];
    const decks = [deck({ id: "a", college: "Ohio State" }), deck({ id: "b", course: "CHEM 2", mine: true })];
    const ids = (f: Parameters<typeof filterDecks>[1]) => filterDecks(decks, f).map((d) => d.id);
    expect(ids({ query: "", college: "ohio state", onlyMine: false })).toEqual(["a"]);
    expect(ids({ query: "chem lee", college: "", onlyMine: false })).toEqual(["b"]);
    expect(ids({ query: "", college: "", onlyMine: true })).toEqual(["b"]);
  });
});

describe("lectures recorded on the phone", () => {
  it("saves a recording, its transcript and a new title", async () => {
    const id = await createLecture(db, { title: "  ", audioPath: "a.m4a", durationSeconds: 95 });
    const fresh = await getLecture(db, id);
    expect(fresh).toMatchObject({ title: defaultLectureTitle(), audioPath: "a.m4a", durationSeconds: 95, status: "pending" });
    expect(fresh?.segments).toEqual([]);

    await saveTranscript(db, id, [
      { id: 7, start: 0, end: 4, text: " Cells are the unit of life. " },
      { id: 8, start: 4, end: 6, text: "   " },
      { id: 9, start: 6, end: 12, text: "Mitochondria make energy." },
    ]);
    await renameLecture(db, id, "Bio 101 · week 3");
    await renameLecture(db, id, "   ");
    const done = await getLecture(db, id);
    expect(done).toMatchObject({
      title: "Bio 101 · week 3",
      status: "done",
      fullText: "Cells are the unit of life. Mitochondria make energy.",
    });
    expect(done?.segments).toEqual([
      { id: 0, start: 0, end: 4, text: "Cells are the unit of life." },
      { id: 1, start: 6, end: 12, text: "Mitochondria make energy." },
    ]);
  });

  it("lists newest first and hands back the audio file on delete", async () => {
    const older = await createLecture(db, { title: "Older", audioPath: "old.m4a", durationSeconds: 10 });
    sqlite.prepare("UPDATE lecture_transcripts SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(older);
    await createLecture(db, { title: "Newer", audioPath: "new.m4a", durationSeconds: 10 });
    expect((await listLectures(db)).map((l) => l.title)).toEqual(["Newer", "Older"]);

    expect(await deleteLecture(db, older)).toBe("old.m4a");
    expect(await deleteLecture(db, older)).toBeNull();
    expect((await listLectures(db)).map((l) => l.title)).toEqual(["Newer"]);
  });

  it("writes rows the desktop's Lectures tab can read", async () => {
    const id = await createLecture(db, { title: "Shared", audioPath: "s.m4a", durationSeconds: 30 });
    await saveTranscript(db, id, [{ id: 0, start: 0, end: 5, text: "Hello class." }]);
    const row = sqlite.prepare("SELECT * FROM lecture_transcripts WHERE id = ?").get(id) as Record<string, unknown>;
    expect(row).toMatchObject({ transcript_status: "done", full_text: "Hello class." });
    expect(JSON.parse(row.segments_json as string)).toEqual([{ id: 0, start: 0, end: 5, text: "Hello class." }]);
  });
});
