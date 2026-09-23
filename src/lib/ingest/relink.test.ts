import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { courses, exams, flashcards, sourceFiles, sourceSlides } from "@/db/schema";

import { relinkCards } from "./relink";

function setup() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });

  const course = db.insert(courses).values({ title: "A&P" }).returning().get();
  const exam = db.insert(exams).values({ courseId: course.id, title: "Exam" }).returning().get();
  const file = db
    .insert(sourceFiles)
    .values({ examId: exam.id, filename: "lecture.txt", fileType: "pasted", role: "notes", rawPath: "x", status: "ready" })
    .returning()
    .get();

  // After a re-split: what used to be all in section 1 is now spread out.
  const [first, second, third] = [
    "Smell begins in the olfactory epithelium.",
    "Olfactory receptor neurons are replaced every few weeks.",
    "Signals travel to the olfactory bulb and then the piriform cortex.",
  ].map((rawText, i) =>
    db.insert(sourceSlides).values({ sourceFileId: file.id, index: i + 1, rawText, tables: [] }).returning().get(),
  );

  const card = (excerpt: string | null) =>
    db
      .insert(flashcards)
      .values({ examId: exam.id, question: "Q", directAnswer: "A", sourceSlideId: first.id, sourceExcerpt: excerpt })
      .returning()
      .get().id;

  return { db, file, first, second, third, card };
}

describe("relinkCards", () => {
  it("moves each card to the section its quote is now in", () => {
    const { db, file, first, second, third, card } = setup();
    const stays = card("Smell begins in the olfactory epithelium.");
    const moves = card("receptor neurons are replaced every few weeks");
    const shortened = card("Signals travel to the olfactory bulb ... piriform cortex.");
    const lost = card("A quote that is nowhere in this file at all.");

    expect(relinkCards(db, file.id)).toBe(2);

    const slideOf = (id: string) =>
      db.select().from(flashcards).where(eq(flashcards.id, id)).get()!.sourceSlideId;
    expect(slideOf(stays)).toBe(first.id);
    expect(slideOf(moves)).toBe(second.id);
    expect(slideOf(shortened)).toBe(third.id);
    // Not found anywhere: left where it was rather than guessed.
    expect(slideOf(lost)).toBe(first.id);
  });
});
