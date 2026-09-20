/**
 * Coverage pipeline tests with a stubbed provider.
 *
 * The stub answers per pass by looking at the system prompt it was handed, so
 * these exercise the real batching, token resolution, provenance checks, and
 * persistence — including the parts that decide what NOT to store.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import {
  contentConflicts,
  courses,
  coverageMappings,
  exams,
  flashcards,
  objectiveCoverage,
  sourceFiles,
  sourceSlides,
  studyGuideObjectives,
  studyProgress,
} from "@/db/schema";
import type { LlmProvider, StructuredRequest } from "@/lib/llm";

import { analyzeCoverageForExam, pairSlidesAcrossFiles } from "./index";
import { CONFLICT_SYSTEM, MAPPING_SYSTEM, REVIEW_SYSTEM } from "./prompts";
import type {
  ConflictResponse,
  CoverageMappingResponse,
  CoverageReviewResponse,
} from "./schemas";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;
let examId: string;
let deckId: string;
let notesId: string;
let objectiveIds: string[];
let cardIds: string[];

type Answer<T> = T | ((request: StructuredRequest) => T);

type Responses = {
  mapping?: Answer<CoverageMappingResponse>;
  review?: Answer<CoverageReviewResponse>;
  conflicts?: Answer<ConflictResponse>;
};

function answer<T>(value: Answer<T> | undefined, request: StructuredRequest, fallback: T): T {
  if (value === undefined) return fallback;
  return typeof value === "function"
    ? (value as (r: StructuredRequest) => T)(request)
    : value;
}

/**
 * Finds the token the pipeline assigned to a given slide in this prompt.
 *
 * Tokens are per-call and deliberately carry no meaning outside it, so a test
 * that hardcodes "S1" is asserting an implementation detail. Reading the token
 * back out of the prompt tests what the model would actually see.
 */
function tokenFor(prompt: string, label: string): string {
  const match = prompt.match(
    new RegExp(`\\[(S\\d+)\\] \\(${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`),
  );
  if (!match) throw new Error(`No token for "${label}" in prompt`);
  return match[1];
}

function stubProvider(responses: Responses) {
  const requests: StructuredRequest[] = [];

  const provider: LlmProvider = {
    name: "stub",
    model: "stub-model",
    generateStructured: vi.fn(async (request: StructuredRequest) => {
      requests.push(request);

      if (request.system === MAPPING_SYSTEM) {
        return {
          data: answer(responses.mapping, request, { objectives: [] }) as never,
        };
      }
      if (request.system === REVIEW_SYSTEM) {
        return {
          data: answer(responses.review, request, { reviews: [] }) as never,
        };
      }
      if (request.system === CONFLICT_SYSTEM) {
        return {
          data: answer(responses.conflicts, request, { conflicts: [] }) as never,
        };
      }
      throw new Error("unexpected system prompt");
    }),
  };

  return { provider, requests };
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
    .values({ courseId: course.id, title: "Exam 2" })
    .returning()
    .get().id;

  deckId = db
    .insert(sourceFiles)
    .values({
      examId,
      filename: "lecture.pptx",
      fileType: "pptx",
      role: "slides",
      rawPath: "lecture.pptx",
      status: "ready",
    })
    .returning()
    .get().id;

  notesId = db
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
      {
        sourceFileId: deckId,
        index: 1,
        title: "Aldosterone",
        rawText:
          "Aldosterone increases sodium reabsorption in the distal tubule.",
      },
      {
        sourceFileId: deckId,
        index: 2,
        title: "ADH",
        rawText: "ADH is released from the posterior pituitary.",
      },
      {
        sourceFileId: notesId,
        index: 1,
        rawText:
          "Aldosterone decreases sodium reabsorption in the distal tubule.",
      },
    ])
    .run();

  objectiveIds = db
    .insert(studyGuideObjectives)
    .values([
      {
        examId,
        orderIndex: 0,
        label: "1",
        promptText: "Explain how aldosterone affects sodium handling.",
      },
      {
        examId,
        orderIndex: 1,
        label: "2",
        promptText: "Describe the countercurrent multiplier in the loop of Henle.",
      },
    ])
    .returning()
    .all()
    .map((row) => row.id);

  cardIds = db
    .insert(flashcards)
    .values([
      {
        examId,
        topic: "Aldosterone",
        question: "What does aldosterone do to sodium reabsorption?",
        directAnswer: "It increases sodium reabsorption in the distal tubule.",
      },
      {
        examId,
        topic: "ADH",
        question: "Where is ADH released from?",
        directAnswer: "The posterior pituitary.",
      },
    ])
    .returning()
    .all()
    .map((row) => row.id);
});

function verdictFor(objectiveId: string) {
  return db
    .select()
    .from(objectiveCoverage)
    .where(eq(objectiveCoverage.objectiveId, objectiveId))
    .get();
}

describe("analyzeCoverageForExam", () => {
  it("stores a verdict per objective and a row per supporting card", async () => {
    const { provider } = stubProvider({
      mapping: {
        objectives: [
          {
            objective: "O1",
            status: "covered",
            cards: [{ card: "C1", status: "covered" }],
            missingPoints: [],
            rationale: "The card states the direction and the site.",
          },
          {
            objective: "O2",
            status: "missing",
            cards: [],
            missingPoints: ["the countercurrent multiplier"],
            rationale: "No card mentions the loop of Henle.",
          },
        ],
      },
      review: {
        reviews: [
          {
            objective: "O1",
            sourceSupport: "silent",
            slideCitation: "",
            sourceExcerpt: "",
            missingPoints: [],
            note: "",
          },
        ],
      },
    });

    const summary = await analyzeCoverageForExam(db, provider, examId, {
      skipConflicts: true,
    });

    expect(summary.objectives).toBe(2);
    expect(summary.covered).toBe(1);
    expect(summary.missing).toBe(1);
    expect(summary.cardsMapped).toBe(1);

    const mappings = db.select().from(coverageMappings).all();
    expect(mappings).toHaveLength(1);
    expect(mappings[0].flashcardId).toBe(cardIds[0]);
    expect(mappings[0].objectiveId).toBe(objectiveIds[0]);

    expect(verdictFor(objectiveIds[0])?.status).toBe("covered");

    const gap = verdictFor(objectiveIds[1]);
    expect(gap?.status).toBe("missing");
    expect(gap?.missingPoints).toEqual(["the countercurrent multiplier"]);
  });

  it("only sends objectives that came back short to the review pass", async () => {
    const { provider, requests } = stubProvider({
      mapping: {
        objectives: [
          {
            objective: "O1",
            status: "covered",
            cards: [{ card: "C1", status: "covered" }],
            missingPoints: [],
            rationale: "",
          },
          {
            objective: "O2",
            status: "missing",
            cards: [],
            missingPoints: [],
            rationale: "",
          },
        ],
      },
    });

    await analyzeCoverageForExam(db, provider, examId, { skipConflicts: true });

    const reviewRequest = requests.find((r) => r.system === REVIEW_SYSTEM);
    expect(reviewRequest?.prompt).toContain("countercurrent multiplier");
    expect(reviewRequest?.prompt).not.toContain("aldosterone affects sodium");
  });

  it("separates a gap the slides can fill from one they cannot", async () => {
    const { provider } = stubProvider({
      mapping: {
        objectives: [
          {
            objective: "O1",
            status: "missing",
            cards: [],
            missingPoints: [],
            rationale: "",
          },
          {
            objective: "O2",
            status: "missing",
            cards: [],
            missingPoints: [],
            rationale: "",
          },
        ],
      },
      review: (request) => ({
        reviews: [
          {
            objective: "O1",
            sourceSupport: "answers",
            slideCitation: tokenFor(request.prompt, "lecture.pptx, slide 1"),
            sourceExcerpt: "Aldosterone increases sodium reabsorption",
            missingPoints: [],
            note: "Slide 1 answers this outright.",
          },
          {
            objective: "O2",
            sourceSupport: "silent",
            slideCitation: "",
            sourceExcerpt: "",
            missingPoints: ["the loop of Henle is never discussed"],
            note: "Nothing in these files covers it.",
          },
        ],
      }),
    });

    const summary = await analyzeCoverageForExam(db, provider, examId, {
      skipConflicts: true,
    });

    expect(summary.fixableGaps).toBe(1);
    expect(summary.sourceGaps).toBe(1);

    const fixable = verdictFor(objectiveIds[0]);
    expect(fixable?.sourceSupport).toBe("answers");
    expect(fixable?.supportingSlideId).not.toBeNull();
    expect(fixable?.supportingExcerpt).toContain("increases sodium");

    expect(verdictFor(objectiveIds[1])?.sourceSupport).toBe("silent");
  });

  it("discards a supporting quote that is not in the slide it cites", async () => {
    const { provider } = stubProvider({
      mapping: {
        objectives: [
          {
            objective: "O1",
            status: "missing",
            cards: [],
            missingPoints: [],
            rationale: "",
          },
          {
            objective: "O2",
            status: "covered",
            cards: [{ card: "C2", status: "covered" }],
            missingPoints: [],
            rationale: "",
          },
        ],
      },
      review: (request) => ({
        reviews: [
          {
            objective: "O1",
            sourceSupport: "answers",
            slideCitation: tokenFor(request.prompt, "lecture.pptx, slide 1"),
            sourceExcerpt: "Aldosterone is secreted by the adrenal medulla",
            missingPoints: [],
            note: "",
          },
        ],
      }),
    });

    const summary = await analyzeCoverageForExam(db, provider, examId, {
      skipConflicts: true,
    });

    expect(summary.unverifiedCitations).toBe(1);

    const verdict = verdictFor(objectiveIds[0]);
    expect(verdict?.supportingExcerpt).toBeNull();
    expect(verdict?.supportingSlideId).toBeNull();
    // An unverifiable quote cannot prove the material fully answers it.
    expect(verdict?.sourceSupport).toBe("partial");
  });

  it("drops card references the model invented", async () => {
    const { provider } = stubProvider({
      mapping: {
        objectives: [
          {
            objective: "O1",
            status: "covered",
            cards: [
              { card: "C1", status: "covered" },
              { card: "C99", status: "covered" },
            ],
            missingPoints: [],
            rationale: "",
          },
        ],
      },
    });

    const summary = await analyzeCoverageForExam(db, provider, examId, {
      skipConflicts: true,
    });

    expect(summary.unresolvedReferences).toBe(1);
    expect(db.select().from(coverageMappings).all()).toHaveLength(1);
  });

  it("records an objective the mapper skipped as missing, not covered", async () => {
    const { provider } = stubProvider({
      mapping: {
        objectives: [
          {
            objective: "O1",
            status: "covered",
            cards: [{ card: "C1", status: "covered" }],
            missingPoints: [],
            rationale: "",
          },
        ],
      },
    });

    await analyzeCoverageForExam(db, provider, examId, { skipConflicts: true });

    expect(verdictFor(objectiveIds[1])?.status).toBe("missing");
  });

  it("refuses a 'covered' verdict that lists no cards", async () => {
    const { provider } = stubProvider({
      mapping: {
        objectives: [
          {
            objective: "O1",
            status: "covered",
            cards: [],
            missingPoints: [],
            rationale: "",
          },
        ],
      },
    });

    await analyzeCoverageForExam(db, provider, examId, { skipConflicts: true });

    expect(verdictFor(objectiveIds[0])?.status).toBe("missing");
  });

  it("recomputes coverage without touching cards or study progress", async () => {
    db.insert(studyProgress)
      .values({ flashcardId: cardIds[0], state: "retained", intervalDays: 9 })
      .run();

    const first = stubProvider({
      mapping: {
        objectives: [
          {
            objective: "O1",
            status: "covered",
            cards: [{ card: "C1", status: "covered" }],
            missingPoints: [],
            rationale: "",
          },
        ],
      },
    });
    await analyzeCoverageForExam(db, first.provider, examId, {
      skipConflicts: true,
    });

    const second = stubProvider({
      mapping: {
        objectives: [
          {
            objective: "O1",
            status: "partially_covered",
            cards: [{ card: "C1", status: "partially_covered" }],
            missingPoints: ["the receptor involved"],
            rationale: "",
          },
        ],
      },
    });
    await analyzeCoverageForExam(db, second.provider, examId, {
      skipConflicts: true,
    });

    // Replaced, not appended.
    expect(db.select().from(coverageMappings).all()).toHaveLength(1);
    expect(db.select().from(objectiveCoverage).all()).toHaveLength(2);
    expect(verdictFor(objectiveIds[0])?.status).toBe("partially_covered");

    expect(db.select().from(flashcards).all().map((c) => c.id)).toEqual(cardIds);
    expect(db.select().from(studyProgress).all()[0].state).toBe("retained");
  });

  it("refuses to run without study-guide objectives", async () => {
    db.delete(studyGuideObjectives).run();
    const { provider } = stubProvider({});

    await expect(
      analyzeCoverageForExam(db, provider, examId, { skipConflicts: true }),
    ).rejects.toThrow(/no study-guide objectives/i);
  });
});

describe("conflict detection", () => {
  it("stores a contradiction when both statements are verbatim", async () => {
    const { provider } = stubProvider({
      conflicts: (request) => ({
        conflicts: [
          {
            topic: "Aldosterone and sodium",
            slideA: tokenFor(request.prompt, "lecture.pptx, slide 1"),
            statementA:
              "Aldosterone increases sodium reabsorption in the distal tubule.",
            slideB: tokenFor(request.prompt, "notes.pdf, slide 1"),
            statementB:
              "Aldosterone decreases sodium reabsorption in the distal tubule.",
            explanation: "One says increases, the other says decreases.",
          },
        ],
      }),
    });

    const summary = await analyzeCoverageForExam(db, provider, examId);

    expect(summary.conflicts).toBe(1);

    const stored = db.select().from(contentConflicts).all();
    expect(stored).toHaveLength(1);
    expect(stored[0].statementA).toContain("increases");
    expect(stored[0].statementB).toContain("decreases");
    expect(stored[0].resolution).toBeNull();
  });

  it("drops a reported conflict whose quote is not in the slide", async () => {
    const { provider } = stubProvider({
      conflicts: (request) => ({
        conflicts: [
          {
            topic: "Aldosterone",
            slideA: tokenFor(request.prompt, "lecture.pptx, slide 1"),
            statementA: "Aldosterone is a catecholamine.",
            slideB: tokenFor(request.prompt, "notes.pdf, slide 1"),
            statementB:
              "Aldosterone decreases sodium reabsorption in the distal tubule.",
            explanation: "Fabricated on one side.",
          },
        ],
      }),
    });

    const summary = await analyzeCoverageForExam(db, provider, examId);

    expect(summary.conflicts).toBe(0);
    expect(summary.unverifiedCitations).toBe(1);
    expect(db.select().from(contentConflicts).all()).toHaveLength(0);
  });

  it("keeps a conflict the student has already resolved", async () => {
    const first = stubProvider({
      conflicts: (request) => ({
        conflicts: [
          {
            topic: "Aldosterone and sodium",
            slideA: tokenFor(request.prompt, "lecture.pptx, slide 1"),
            statementA:
              "Aldosterone increases sodium reabsorption in the distal tubule.",
            slideB: tokenFor(request.prompt, "notes.pdf, slide 1"),
            statementB:
              "Aldosterone decreases sodium reabsorption in the distal tubule.",
            explanation: "Opposite directions.",
          },
        ],
      }),
    });
    await analyzeCoverageForExam(db, first.provider, examId);

    const stored = db.select().from(contentConflicts).all()[0];
    db.update(contentConflicts)
      .set({ resolution: "The lecture slide is right; my notes have a typo." })
      .where(eq(contentConflicts.id, stored.id))
      .run();

    const second = stubProvider({ conflicts: { conflicts: [] } });
    await analyzeCoverageForExam(db, second.provider, examId);

    const after = db.select().from(contentConflicts).all();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(stored.id);
    expect(after[0].resolution).toContain("lecture slide is right");
  });
});

describe("pairSlidesAcrossFiles", () => {
  it("never pairs two slides from the same file", () => {
    const slides = db
      .select({ slide: sourceSlides })
      .from(sourceSlides)
      .all()
      .map(({ slide }) => ({ slide, fileName: "x" }));

    const pairs = pairSlidesAcrossFiles(slides);

    expect(pairs.length).toBeGreaterThan(0);
    for (const pair of pairs) {
      expect(pair.a.slide.sourceFileId).not.toBe(pair.b.slide.sourceFileId);
    }
  });

  it("finds the same pairs whichever file is listed first", () => {
    const slides = db
      .select({ slide: sourceSlides })
      .from(sourceSlides)
      .all()
      .map(({ slide }) => ({ slide, fileName: "x" }));

    const keys = (pairs: ReturnType<typeof pairSlidesAcrossFiles>) =>
      pairs.map((p) => [p.a.slide.id, p.b.slide.id].sort().join("|")).sort();

    // With a per-slide match budget, iterating the three-page notes first used
    // to yield a third as many pairs as iterating the deck first.
    const options = { matchesPerSlide: 1, minScore: 0 };
    expect(keys(pairSlidesAcrossFiles([...slides].reverse(), options))).toEqual(
      keys(pairSlidesAcrossFiles(slides, options)),
    );
  });

  it("returns nothing when there is only one file to compare", () => {
    const slides = db
      .select({ slide: sourceSlides })
      .from(sourceSlides)
      .where(eq(sourceSlides.sourceFileId, deckId))
      .all()
      .map(({ slide }) => ({ slide, fileName: "deck.pptx" }));

    expect(pairSlidesAcrossFiles(slides)).toEqual([]);
  });
});
