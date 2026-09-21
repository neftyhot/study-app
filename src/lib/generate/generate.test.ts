/**
 * Pipeline tests with a stubbed provider.
 *
 * The stub implements `LlmProvider`, not the Gemini SDK — that is the point of
 * the provider boundary, and it means these tests exercise the real batching,
 * validation, and persistence paths without a network call or an API key.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import {
  cardRubrics,
  courses,
  exams,
  flashcards,
  sourceFiles,
  sourceSlides,
  studyGuideObjectives,
  studyProgress,
} from "@/db/schema";
import type { LlmProvider, StructuredRequest } from "@/lib/llm";

import { clearGeneratedCards, generateCardsForExam } from "./index";
import type { GeneratedCard, GenerationResponse } from "./schemas";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;
let examId: string;
let fileId: string;

/** Returns canned responses in order, and records every request it received. */
function stubProvider(responses: GenerationResponse[]) {
  const requests: StructuredRequest[] = [];
  let call = 0;

  const provider: LlmProvider = {
    name: "stub",
    model: "stub-model",
    generateStructured: vi.fn(async (request: StructuredRequest) => {
      requests.push(request);
      const data = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return { data: data as never };
    }),
  };

  return { provider, requests, callCount: () => call };
}

function card(overrides: Partial<GeneratedCard> = {}): GeneratedCard {
  return {
    topic: "ADH",
    facet: "origin",
    cardType: "atomic",
    question: "Where is ADH produced?",
    directAnswer: "The hypothalamus.",
    hasAiSupplement: false,
    slideCitation: "S1",
    sourceExcerpt: "Body line one for slide 1",
    essentialPoints: ["hypothalamus"],
    optionalPoints: ["magnocellular neurons"],
    commonMisconceptions: ["Produced by the posterior pituitary"],
    ...overrides,
  };
}

function seedSlides(count: number) {
  for (let i = 1; i <= count; i++) {
    db.insert(sourceSlides)
      .values({
        sourceFileId: fileId,
        index: i,
        title: `Slide ${i} Title`,
        rawText: `Body line one for slide ${i}\nBody line two for slide ${i}`,
      })
      .run();
  }
}

beforeEach(() => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });

  const course = db
    .insert(courses)
    .values({ title: "Physiology" })
    .returning()
    .get();
  examId = db
    .insert(exams)
    .values({ courseId: course.id, title: "Exam 2", scopeMode: "files" })
    .returning()
    .get().id;
  fileId = db
    .insert(sourceFiles)
    .values({
      examId,
      filename: "deck.pptx",
      fileType: "pptx",
      role: "slides",
      rawPath: "deck.pptx",
      status: "ready",
    })
    .returning()
    .get().id;
});

describe("generateCardsForExam", () => {
  it("never puts two files in one batch, so citation tokens stay unique", async () => {
    seedSlides(2);

    // A second file whose page numbers collide with the deck's slide numbers.
    const notesId = db
      .insert(sourceFiles)
      .values({
        examId,
        filename: "notes.pdf",
        fileType: "pdf",
        role: "notes",
        rawPath: "notes.pdf",
        status: "ready",
      })
      .returning()
      .get().id;
    db.insert(sourceSlides)
      .values([
        { sourceFileId: notesId, index: 1, rawText: "Notes page one text" },
        { sourceFileId: notesId, index: 2, rawText: "Notes page two text" },
      ])
      .run();

    const { provider, requests } = stubProvider([{ cards: [] }]);

    // All four units would fit in one batch if batching ignored file boundaries.
    await generateCardsForExam(db, provider, examId, { batchSize: 8 });

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      const tokens = request.prompt.match(/\[S\d+\]/g) ?? [];
      expect(new Set(tokens).size).toBe(tokens.length);
    }
  });


  it("stores validated cards with their rubric and provenance", async () => {
    seedSlides(2);
    const { provider } = stubProvider([{ cards: [card()] }]);

    const summary = await generateCardsForExam(db, provider, examId);

    expect(summary.cardsCreated).toBe(1);
    expect(summary.cardsRejected).toBe(0);

    const stored = db.select().from(flashcards).all();
    expect(stored).toHaveLength(1);
    expect(stored[0].question).toBe("Where is ADH produced?");
    expect(stored[0].sourceExcerpt).toBe("Body line one for slide 1");
    expect(stored[0].cardType).toBe("atomic");

    // Provenance resolves to the real slide row, not the citation token.
    const slide = db
      .select()
      .from(sourceSlides)
      .where(eq(sourceSlides.id, stored[0].sourceSlideId!))
      .get();
    expect(slide?.index).toBe(1);

    const rubric = db.select().from(cardRubrics).all();
    expect(rubric[0].essentialPoints).toEqual(["hypothalamus"]);
    expect(rubric[0].commonMisconceptions).toEqual([
      "Produced by the posterior pituitary",
    ]);
  });

  it("sends a JSON schema on every request", async () => {
    seedSlides(2);
    const { provider, requests } = stubProvider([{ cards: [card()] }]);

    await generateCardsForExam(db, provider, examId);

    expect(requests).toHaveLength(1);
    expect(requests[0].schema).toMatchObject({ type: "object" });
    expect(requests[0].temperature).toBe(0);
    // Atomization survives whatever density the deck is set to; only the
    // heading above it changes.
    expect(requests[0].system).toContain(
      "One card tests exactly ONE fact",
    );
  });

  it("batches slides and calls the model once per batch", async () => {
    seedSlides(20);
    const { provider, callCount } = stubProvider([{ cards: [] }]);

    const summary = await generateCardsForExam(db, provider, examId, {
      batchSize: 8,
    });

    expect(summary.batchCount).toBe(3); // 8 + 8 + 4
    expect(callCount()).toBe(3);
  });

  it("does not store a card whose excerpt is absent from the source", async () => {
    seedSlides(2);
    const { provider } = stubProvider([
      {
        cards: [
          card(),
          card({
            question: "What does ADH do to the collecting duct?",
            sourceExcerpt: "ADH inserts aquaporin-2 channels",
          }),
        ],
      },
    ]);

    const summary = await generateCardsForExam(db, provider, examId);

    expect(summary.cardsCreated).toBe(1);
    expect(summary.cardsRejected).toBe(1);
    expect(summary.rejections[0].reason).toBe("excerpt_not_in_source");
    expect(db.select().from(flashcards).all()).toHaveLength(1);
  });

  it("surfaces concepts the source never explains instead of inventing them", async () => {
    seedSlides(2);
    const { provider } = stubProvider([
      { cards: [], uncoveredNotes: ["Renin-angiotensin cascade is not explained"] },
    ]);

    const summary = await generateCardsForExam(db, provider, examId);

    expect(summary.cardsCreated).toBe(0);
    expect(summary.uncoveredNotes).toEqual([
      "Renin-angiotensin cascade is not explained",
    ]);
  });

  it("includes speaker notes and tables in the prompt", async () => {
    db.insert(sourceSlides)
      .values({
        sourceFileId: fileId,
        index: 1,
        title: "Hormones",
        rawText: "Overview",
        speakerNotes: "Emphasised: ADH acts on V2 receptors.",
        tables: [{ rows: [["Hormone", "Action"], ["ADH", "Water reabsorption"]] }],
      })
      .run();

    const { provider, requests } = stubProvider([{ cards: [] }]);
    await generateCardsForExam(db, provider, examId);

    expect(requests[0].prompt).toContain("Emphasised: ADH acts on V2 receptors.");
    expect(requests[0].prompt).toContain("ADH | Water reabsorption");
    expect(requests[0].prompt).toContain("[S1]");
  });

  it("never rewrites existing cards or progress when re-run", async () => {
    seedSlides(2);
    const { provider } = stubProvider([{ cards: [card()] }]);

    await generateCardsForExam(db, provider, examId);
    const original = db.select().from(flashcards).all()[0];

    // Simulate the student editing the card and studying it.
    db.update(flashcards)
      .set({ question: "Where exactly is ADH made?", isUserEdited: true })
      .where(eq(flashcards.id, original.id))
      .run();
    db.insert(studyProgress)
      .values({ flashcardId: original.id, state: "retained", intervalDays: 21 })
      .run();

    const second = stubProvider([
      { cards: [card({ question: "What triggers ADH release?" })] },
    ]);
    await generateCardsForExam(db, second.provider, examId);

    const edited = db
      .select()
      .from(flashcards)
      .where(eq(flashcards.id, original.id))
      .get();
    expect(edited?.question).toBe("Where exactly is ADH made?");
    expect(edited?.isUserEdited).toBe(true);

    const progress = db
      .select()
      .from(studyProgress)
      .where(eq(studyProgress.flashcardId, original.id))
      .get();
    expect(progress?.state).toBe("retained");
    expect(progress?.intervalDays).toBe(21);

    // The new card was appended alongside it.
    expect(db.select().from(flashcards).all()).toHaveLength(2);
  });

  it("does not duplicate a card that already exists", async () => {
    seedSlides(2);

    const first = stubProvider([{ cards: [card()] }]);
    await generateCardsForExam(db, first.provider, examId);

    const second = stubProvider([{ cards: [card()] }]);
    const summary = await generateCardsForExam(db, second.provider, examId);

    expect(summary.cardsCreated).toBe(0);
    expect(summary.rejections[0].reason).toBe("duplicate");
    expect(db.select().from(flashcards).all()).toHaveLength(1);
  });
});

describe("study-guide focus mode", () => {
  beforeEach(() => {
    db.update(exams)
      .set({ scopeMode: "objectives" })
      .where(eq(exams.id, examId))
      .run();
  });

  it("anchors the prompt to the study-guide objectives", async () => {
    seedSlides(2);
    db.insert(studyGuideObjectives)
      .values({
        examId,
        orderIndex: 0,
        label: "1",
        promptText: "Describe where ADH is produced.",
      })
      .run();

    const { provider, requests } = stubProvider([{ cards: [card()] }]);
    const summary = await generateCardsForExam(db, provider, examId);

    expect(summary.mode).toBe("objectives");
    expect(requests[0].prompt).toContain("STUDY-GUIDE OBJECTIVES");
    expect(requests[0].prompt).toContain("1. Describe where ADH is produced.");
  });

  it("refuses to run rather than silently falling back to full coverage", async () => {
    seedSlides(2);
    const { provider, callCount } = stubProvider([{ cards: [] }]);

    await expect(
      generateCardsForExam(db, provider, examId),
    ).rejects.toThrow(/no objectives/i);

    expect(callCount()).toBe(0);
  });

  it("omits excluded objectives", async () => {
    seedSlides(2);
    db.insert(studyGuideObjectives)
      .values([
        { examId, orderIndex: 0, label: "1", promptText: "Included objective." },
        {
          examId,
          orderIndex: 1,
          label: "2",
          promptText: "Excluded objective.",
          excluded: true,
        },
      ])
      .run();

    const { provider, requests } = stubProvider([{ cards: [] }]);
    await generateCardsForExam(db, provider, examId);

    expect(requests[0].prompt).toContain("Included objective.");
    expect(requests[0].prompt).not.toContain("Excluded objective.");
  });
});

describe("preconditions", () => {
  it("fails clearly when there are no ingested slides", async () => {
    const { provider } = stubProvider([{ cards: [] }]);

    await expect(
      generateCardsForExam(db, provider, examId),
    ).rejects.toThrow(/Upload and ingest sources first/);
  });

  it("ignores study-guide files as answer material", async () => {
    seedSlides(2);
    const guideFile = db
      .insert(sourceFiles)
      .values({
        examId,
        filename: "guide.pdf",
        fileType: "pdf",
        role: "study_guide",
        rawPath: "guide.pdf",
        status: "ready",
      })
      .returning()
      .get();
    db.insert(sourceSlides)
      .values({
        sourceFileId: guideFile.id,
        index: 1,
        rawText: "GUIDE_ONLY_MARKER",
      })
      .run();

    const { provider, requests } = stubProvider([{ cards: [] }]);
    await generateCardsForExam(db, provider, examId);

    expect(requests[0].prompt).not.toContain("GUIDE_ONLY_MARKER");
  });
});

describe("clearGeneratedCards", () => {
  it("removes generated cards but keeps the ones the student edited", () => {
    seedSlides(1);

    const generated = db
      .insert(flashcards)
      .values({ examId, question: "Generated", directAnswer: "A" })
      .returning()
      .get();
    const edited = db
      .insert(flashcards)
      .values({
        examId,
        question: "Edited",
        directAnswer: "A",
        isUserEdited: true,
      })
      .returning()
      .get();
    db.insert(cardRubrics)
      .values({ flashcardId: generated.id, essentialPoints: ["x"] })
      .run();
    db.insert(studyProgress)
      .values({ flashcardId: generated.id, state: "retained" })
      .run();

    const result = clearGeneratedCards(db, examId);

    expect(result).toEqual({ deleted: 1, kept: 1 });
    expect(db.select().from(flashcards).all().map((c) => c.id)).toEqual([
      edited.id,
    ]);
    // Rubric and progress go with the card they belonged to.
    expect(db.select().from(cardRubrics).all()).toHaveLength(0);
    expect(db.select().from(studyProgress).all()).toHaveLength(0);
  });

  it("does nothing to a deck with no generated cards", () => {
    expect(clearGeneratedCards(db, examId)).toEqual({ deleted: 0, kept: 0 });
  });
});

describe("slide range", () => {
  it("uses only the pages in range, and keeps their real page numbers", async () => {
    seedSlides(10);
    const { provider, requests } = stubProvider([{ cards: [] }]);

    await generateCardsForExam(db, provider, examId, {
      ranges: { [fileId]: { from: 4, to: 6 } },
      batchSize: 50,
    });

    // Citations are the numbers printed on the student's own file, so a
    // filtered range must not renumber what it kept: pages 4-6 stay S4-S6.
    expect(requests).toHaveLength(1);
    const tokens = [...requests[0].prompt.matchAll(/\[S(\d+)\]/g)].map((m) =>
      Number(m[1]),
    );
    expect(tokens).toEqual([4, 5, 6]);
  });

  it("reports how many units it actually used", async () => {
    seedSlides(10);
    const { provider } = stubProvider([{ cards: [] }]);

    const summary = await generateCardsForExam(db, provider, examId, {
      ranges: { [fileId]: { from: 2, to: 5 } },
    });

    expect(summary.unitsUsed).toBe(4);
  });

  it("leaves a file with no range entry whole", async () => {
    seedSlides(4);
    const otherId = db
      .insert(sourceFiles)
      .values({
        examId,
        filename: "notes.pdf",
        fileType: "pdf",
        role: "notes",
        rawPath: "notes.pdf",
        status: "ready",
      })
      .returning()
      .get().id;
    db.insert(sourceSlides)
      .values([
        { sourceFileId: otherId, index: 1, rawText: "Notes page one text" },
        { sourceFileId: otherId, index: 2, rawText: "Notes page two text" },
      ])
      .run();

    const { provider } = stubProvider([{ cards: [] }]);
    const summary = await generateCardsForExam(db, provider, examId, {
      ranges: { [fileId]: { from: 1, to: 1 } },
    });

    // One page of the deck, both pages of the untouched notes file.
    expect(summary.unitsUsed).toBe(3);
  });

  it("explains an empty range rather than blaming the upload", async () => {
    seedSlides(4);
    const { provider } = stubProvider([{ cards: [] }]);

    await expect(
      generateCardsForExam(db, provider, examId, {
        ranges: { [fileId]: { from: 90, to: 99 } },
      }),
    ).rejects.toThrow(/range you chose/i);
  });
});

describe("extraction density", () => {
  it("sends the density the exam remembers", async () => {
    seedSlides(2);
    db.update(exams)
      .set({ extractionDensity: "high_yield" })
      .where(eq(exams.id, examId))
      .run();

    const { provider, requests } = stubProvider([{ cards: [] }]);
    const summary = await generateCardsForExam(db, provider, examId, {});

    expect(summary.density).toBe("high_yield");
    expect(requests[0].system).toContain("be selective");
    expect(requests[0].system).not.toContain("There is no limit on card count");
  });

  it("lets a run override the stored density", async () => {
    seedSlides(2);
    const { provider, requests } = stubProvider([{ cards: [] }]);

    await generateCardsForExam(db, provider, examId, { density: "exhaustive" });

    expect(requests[0].system).toContain("There is no limit on card count");
  });

  it("gives the model a number only when the student set one", async () => {
    seedSlides(2);
    const preset = stubProvider([{ cards: [] }]);
    await generateCardsForExam(db, preset.provider, examId, {
      density: "standard",
    });
    expect(preset.requests[0].system).not.toContain("TARGET DENSITY");

    const custom = stubProvider([{ cards: [] }]);
    await generateCardsForExam(db, custom.provider, examId, {
      density: "custom",
      densityRatio: 1.8,
    });
    expect(custom.requests[0].system).toContain("roughly 1.8 cards per slide");
  });

  it("keeps provenance and rubric rules identical at every density", async () => {
    seedSlides(2);

    for (const density of ["high_yield", "standard", "exhaustive"] as const) {
      const { provider, requests } = stubProvider([{ cards: [] }]);
      await generateCardsForExam(db, provider, examId, { density });

      // A sparser deck is a smaller selection of the same material, never a
      // looser standard for it.
      expect(requests[0].system).toContain("PROVENANCE (non-negotiable)");
      expect(requests[0].system).toContain("copied VERBATIM");
      expect(requests[0].system).toContain("essentialPoints are what a typed answer MUST say");
    }
  });
});
