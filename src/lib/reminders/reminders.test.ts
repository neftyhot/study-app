/** Reminders are off by default, once a day, after the chosen time, and say only a count. */
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";

import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { flashcards, studyProgress } from "@/db/schema";
import { insertDeck } from "@/lib/decks/insert";
import {
  DEFAULT_REMINDERS,
  countAllDue,
  readReminders,
  reminderMessage,
  sanitizeReminders,
  shouldRemind,
  writeReminders,
} from "@/lib/reminders/reminders";
import { SAMPLE_DECK } from "@/lib/sample/memory-deck";

function freshDb() {
  const db = drizzle(new Database(":memory:"), { schema }) as unknown as Db;
  migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

const on = { enabled: true, time: "18:00" };
const at = (h: number, m = 0) => new Date(2026, 9, 21, h, m);

describe("reminder settings", () => {
  it("start off", () => {
    expect(DEFAULT_REMINDERS.enabled).toBe(false);
    expect(readReminders(freshDb())).toEqual(DEFAULT_REMINDERS);
  });

  it("keep only a valid time", () => {
    expect(sanitizeReminders({ enabled: true, time: "25:00" })).toEqual({ enabled: true, time: "18:00" });
    expect(sanitizeReminders({ enabled: "yes", time: "07:30" })).toEqual({ enabled: false, time: "07:30" });
    expect(sanitizeReminders(null)).toEqual(DEFAULT_REMINDERS);
  });

  it("round-trip through the database", () => {
    const db = freshDb();
    writeReminders({ enabled: true, time: "08:15", extra: 1 }, db);
    expect(readReminders(db)).toEqual({ enabled: true, time: "08:15" });
  });
});

describe("when to remind", () => {
  it("not when off, nothing is due, or before the time", () => {
    expect(shouldRemind(DEFAULT_REMINDERS, 5, at(19), null)).toBe(false);
    expect(shouldRemind(on, 0, at(19), null)).toBe(false);
    expect(shouldRemind(on, 5, at(17, 59), null)).toBe(false);
  });

  it("once a day, from the chosen time on", () => {
    expect(shouldRemind(on, 5, at(18), null)).toBe(true);
    expect(shouldRemind(on, 5, at(23), "2026-10-20")).toBe(true);
    expect(shouldRemind(on, 5, at(23), "2026-10-21")).toBe(false);
  });

  it("says a count and nothing else", () => {
    expect(reminderMessage(1).body).toBe("1 card is due today.");
    expect(reminderMessage(12)).toEqual({ title: "Time to review", body: "12 cards are due today." });
  });
});

describe("counting due cards", () => {
  it("counts due and overdue cards across decks, skipping excluded ones", () => {
    const db = freshDb();
    insertDeck(db, SAMPLE_DECK);
    insertDeck(db, SAMPLE_DECK);
    const cards = db.select().from(flashcards).all();
    const due = (i: number, day: string) =>
      db.insert(studyProgress).values({ flashcardId: cards[i].id, state: "recognition", nextReviewDue: day }).run();
    due(0, "2026-10-20");
    due(1, "2026-10-21");
    due(2, "2026-10-22");
    due(cards.length - 1, "2026-10-01");
    due(3, "2026-10-01");
    db.update(flashcards).set({ excluded: true }).where(eq(flashcards.id, cards[3].id)).run();
    expect(countAllDue(db, "2026-10-21")).toBe(3);
  });
});
