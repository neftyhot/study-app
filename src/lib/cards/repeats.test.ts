/**
 * Repeated cards. The cases are the ones a history deck actually produced:
 * the same question twice, a reworded question, and a second card that says
 * what the first did plus a detail — and, as importantly, the near misses
 * that are different cards and must both survive.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { courses, exams, flashcards, studyProgress } from "@/db/schema";

import { findRepeats, removeRepeats, type RepeatCandidate } from "./repeats";

let n = 0;
function card(question: string, directAnswer: string, extra: Partial<RepeatCandidate> = {}) {
  n += 1;
  return { id: `c${n}`, question, directAnswer, ...extra };
}

describe("findRepeats", () => {
  it("drops a word-for-word copy", () => {
    const a = card("When did WW1 begin?", "1914");
    const b = card("When did WW1 begin?", "In 1914");
    const groups = findRepeats([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].drop).toHaveLength(1);
  });

  it("keeps the card that says the same thing plus more", () => {
    const short = card("When did the United States enter WW1?", "April 1917");
    const full = card(
      "When and why did the United States enter WW1?",
      "April 1917, after Germany resumed unrestricted submarine warfare and the Zimmermann Telegram came to light",
    );
    const groups = findRepeats([short, full]);
    expect(groups).toEqual([{ keep: full, drop: [short] }]);
  });

  it("keeps a reworded question once", () => {
    const a = card(
      "What event triggered the outbreak of World War I in 1914?",
      "The assassination of Archduke Franz Ferdinand in Sarajevo",
    );
    const b = card(
      "Which event in 1914 triggered the outbreak of World War I?",
      "Assassination of Archduke Franz Ferdinand in Sarajevo",
    );
    expect(findRepeats([a, b])).toHaveLength(1);
  });

  it("keeps different questions about the same event", () => {
    const who = card("Who assassinated Archduke Franz Ferdinand?", "Gavrilo Princip");
    const where = card("Where was Archduke Franz Ferdinand assassinated?", "Sarajevo");
    expect(findRepeats([who, where])).toEqual([]);
  });

  it("keeps cards that each add something the other lacks", () => {
    const causes = card(
      "What were the main causes of World War I?",
      "Militarism, alliances, imperialism and nationalism",
    );
    const effects = card(
      "What were the main effects of World War I?",
      "Collapse of four empires, the Treaty of Versailles and the League of Nations",
    );
    expect(findRepeats([causes, effects])).toEqual([]);
  });

  it("does not treat short look-alikes as repeats", () => {
    expect(findRepeats([card("What is TSH?", "Thyroid stimulating hormone"), card("What is ACTH?", "Adrenocorticotropic hormone")])).toEqual([]);
  });

  it("drops a card whose fact the fuller card states alongside another", () => {
    const one = card("Which constitutional amendment instituted national Prohibition?", "The 18th Amendment.");
    const both = card(
      "Which constitutional amendment repealed Prohibition, and which amendment had established it?",
      "The 21st Amendment ended Prohibition, which was originally instituted by the 18th Amendment.",
    );
    expect(findRepeats([one, both])).toEqual([{ keep: both, drop: [one] }]);
  });

  it("keeps cards that ask the opposite case", () => {
    const pairs = [
      [
        card("How does a decrease in selling price per unit affect contribution margin per unit?", "It decreases the contribution margin per unit by the same amount."),
        card("How does an increase in variable cost per unit affect contribution margin per unit?", "It decreases the contribution margin per unit dollar for dollar."),
      ],
      [
        card("Which manufacturing costs are product costs under absorption costing?", "All manufacturing costs: direct materials, direct labor, variable and fixed overhead."),
        card("Which manufacturing costs are product costs under variable costing?", "Direct materials, direct labor and variable overhead."),
      ],
      [
        card("Which method of disposing of overhead balances is more accurate?", "Closing proportionally to Work in Process, Finished Goods and Cost of Goods Sold, which is harder than closing to Cost of Goods Sold."),
        card("Which method of disposing of overhead balances is easier?", "Closing to Cost of Goods Sold."),
      ],
    ];
    for (const pair of pairs) expect(findRepeats(pair)).toEqual([]);
  });

  it("keeps a card whose answer merely appears inside another's", () => {
    const overhead = card("What is included in manufacturing overhead?", "All manufacturing costs that are not direct labor or direct materials.");
    const product = card(
      "Which manufacturing costs are product costs under absorption costing?",
      "All manufacturing costs, including direct materials, direct labor, and manufacturing overhead, both variable and fixed.",
    );
    expect(findRepeats([overhead, product])).toEqual([]);
  });

  it("never drops a card the student edited", () => {
    const edited = card("When did WW1 begin?", "1914", { isUserEdited: true });
    const copy = card("When did WW1 begin?", "1914 in Europe");
    const groups = findRepeats([edited, copy]);
    expect(groups).toEqual([{ keep: edited, drop: [copy] }]);
  });
});

describe("removeRepeats", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let examId: string;

  beforeEach(() => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: "./drizzle" });
    const course = db.insert(courses).values({ title: "History" }).returning().get();
    examId = db.insert(exams).values({ courseId: course.id, title: "WW1 on" }).returning().get().id;
  });

  it("keeps the fuller card and carries over the star and history", () => {
    const [short, full] = db
      .insert(flashcards)
      .values([
        { examId, question: "When did the United States enter WW1?", directAnswer: "April 1917", starred: true },
        {
          examId,
          question: "When and why did the United States enter WW1?",
          directAnswer: "April 1917, after unrestricted submarine warfare resumed",
        },
      ])
      .returning()
      .all();
    db.insert(studyProgress).values({ flashcardId: short.id, state: "immediate_recall" }).run();

    const result = removeRepeats(db, examId);

    expect(result.removed).toBe(1);
    const left = db.select().from(flashcards).where(eq(flashcards.examId, examId)).all();
    expect(left.map((row) => row.id)).toEqual([full.id]);
    expect(left[0].starred).toBe(true);
    const progress = db.select().from(studyProgress).all();
    expect(progress.map((row) => row.flashcardId)).toEqual([full.id]);
  });

  it("removes only the cards it was allowed to", () => {
    const [old, fresh] = db
      .insert(flashcards)
      .values([
        { examId, question: "When did WW1 begin?", directAnswer: "1914" },
        { examId, question: "When did WW1 begin?", directAnswer: "In 1914" },
      ])
      .returning()
      .all();
    const result = removeRepeats(db, examId, { onlyRemove: new Set([fresh.id]) });
    expect(result.removedIds).toEqual([fresh.id]);
    const left = db.select().from(flashcards).all();
    expect(left.map((row) => row.id)).toEqual([old.id]);
  });

  it("does nothing to a deck without repeats", () => {
    db.insert(flashcards)
      .values([
        { examId, question: "Who assassinated Archduke Franz Ferdinand?", directAnswer: "Gavrilo Princip" },
        { examId, question: "Where was Archduke Franz Ferdinand assassinated?", directAnswer: "Sarajevo" },
      ])
      .run();
    expect(removeRepeats(db, examId).removed).toBe(0);
  });
});
