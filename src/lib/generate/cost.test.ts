/**
 * The cost-reduction contract: bulk runs on the cheap model with a lean card,
 * explanations are written once and on demand, and spend is reported.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import {
  cardRubrics,
  courses,
  exams,
  flashcards,
  sourceFiles,
  sourceSlides,
} from "@/db/schema";
import type { LlmProvider, StructuredRequest } from "@/lib/llm";
import { isModelUnavailable } from "@/lib/llm/gemini";
import { estimateCost, formatCost } from "@/lib/llm/pricing";

import { calibrationFor, expectedFor } from "./density";

import { explainCard, explainPrompt } from "./enrich";
import { generateCardsForExam } from "./index";
import { generationSystem } from "./prompts";
import { generatedCardSchema } from "./schemas";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;
let examId: string;
let slideId: string;

beforeEach(() => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });

  const course = db.insert(courses).values({ title: "Physiology" }).returning().get();
  examId = db
    .insert(exams)
    .values({ courseId: course.id, title: "Exam 2", scopeMode: "files" })
    .returning()
    .get().id;
  const fileId = db
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
  slideId = db
    .insert(sourceSlides)
    .values({
      sourceFileId: fileId,
      index: 1,
      title: "ADH",
      rawText: "ADH is produced in the hypothalamus. Know this for the exam.",
    })
    .returning()
    .get().id;
});

afterEach(() => vi.restoreAllMocks());

function provider(
  model: string,
  data: unknown,
  usage = { inputTokens: 1000, outputTokens: 200 },
) {
  const requests: StructuredRequest[] = [];
  const llm: LlmProvider = {
    name: "stub",
    model,
    generateStructured: vi.fn(async (request: StructuredRequest) => {
      requests.push(request);
      return { data: data as never, usage };
    }),
  };
  return { llm, requests };
}

describe("pricing", () => {
  it("prices flash-lite at $0.10 in and $0.40 out per million", () => {
    expect(
      estimateCost("gemini-2.5-flash-lite", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(0.5);
  });

  it("reports an unknown model's cost as unknown, not zero", () => {
    expect(estimateCost("stub-model", { inputTokens: 5, outputTokens: 5 })).toBeNull();
    expect(formatCost(null)).toBe("cost unknown");
  });
});

describe("lean bulk schema", () => {
  const item = (
    generatedCardSchema("lean") as {
      properties: {
        cards: { items: { properties: Record<string, unknown>; required: string[] } };
      };
    }
  ).properties.cards.items;

  it("asks for no explanation, misconceptions, or facet", () => {
    for (const key of [
      "fullExplanation",
      "commonMisconceptions",
      "optionalPoints",
      "hasAiSupplement",
      "facet",
    ]) {
      expect(item.properties).not.toHaveProperty(key);
    }
  });

  it("requires professor emphasis and keeps provenance", () => {
    expect(item.required).toEqual(
      expect.arrayContaining([
        "question",
        "directAnswer",
        "topic",
        "essentialPoints",
        "slideCitation",
        "sourceExcerpt",
        "professorEmphasis",
      ]),
    );
  });

  it("tells the model not to write essays", () => {
    expect(generationSystem("standard", null, "lean")).toContain(
      "Do NOT generate long explanations, background essays, or misconception lists",
    );
  });
});

describe("bulk generation", () => {
  it("stores no explanation, records emphasis, and totals tokens and cost", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { llm } = provider("gemini-2.5-flash-lite", {
      cards: [
        {
          topic: "ADH",
          cardType: "atomic",
          question: "Where is ADH produced?",
          directAnswer: "The hypothalamus.",
          slideCitation: "S1",
          sourceExcerpt: "ADH is produced in the hypothalamus.",
          essentialPoints: ["hypothalamus"],
          professorEmphasis: true,
        },
      ],
    });

    const summary = await generateCardsForExam(db, llm, examId);

    const stored = db.select().from(flashcards).all();
    expect(stored).toHaveLength(1);
    expect(stored[0].fullExplanation).toBeNull();
    expect(stored[0].professorEmphasis).toBe(true);
    expect(
      db.select().from(cardRubrics).get()?.commonMisconceptions,
    ).toEqual([]);

    expect(summary.model).toBe("gemini-2.5-flash-lite");
    expect(summary.usage.inputTokens).toBe(1000);
    expect(summary.usage.outputTokens).toBe(200);
    expect(summary.usage.estimatedCostUsd).toBeCloseTo(0.00018);

    const logged = vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
    expect(logged.some((line) => /batch 1\/1: .*1000 in \/ 200 out tokens/.test(line))).toBe(true);
  });
});

describe("explainCard", () => {
  function insertCard(fullExplanation: string | null) {
    const id = db
      .insert(flashcards)
      .values({
        examId,
        question: "Where is ADH produced?",
        directAnswer: "The hypothalamus.",
        fullExplanation,
        sourceSlideId: slideId,
        sourceExcerpt: "ADH is produced in the hypothalamus.",
      })
      .returning()
      .get().id;
    db.insert(cardRubrics)
      .values({ flashcardId: id, essentialPoints: ["hypothalamus"] })
      .run();
    return id;
  }

  it("answers a stored explanation without touching a provider", async () => {
    const id = insertCard("Already written.");
    const getLlm = vi.fn(() => {
      throw new Error("should not be called");
    });

    const result = await explainCard(db, getLlm, id);

    expect(result).toMatchObject({ fullExplanation: "Already written.", cached: true });
    expect(getLlm).not.toHaveBeenCalled();
  });

  it("writes it once, stores it with two misconceptions, then serves it from SQLite", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const id = insertCard(null);
    const { llm, requests } = provider("gemini-2.5-flash", {
      fullExplanation: "First paragraph.\n\nSecond paragraph.",
      hasAiSupplement: true,
      commonMisconceptions: ["Posterior pituitary makes it", "Kidney makes it", "extra"],
    });

    const first = await explainCard(db, () => llm, id);
    expect(first).toMatchObject({
      cached: false,
      fullExplanation: "First paragraph.\n\nSecond paragraph.",
      hasAiSupplement: true,
      commonMisconceptions: ["Posterior pituitary makes it", "Kidney makes it"],
    });
    expect(requests[0].prompt).toContain("Given this question: Where is ADH produced?");
    expect(requests[0].prompt).toContain("2-paragraph conceptual breakdown and 2 common misconceptions");

    const row = db.select().from(flashcards).where(eq(flashcards.id, id)).get();
    expect(row?.fullExplanation).toContain("Second paragraph.");

    const second = await explainCard(db, () => llm, id);
    expect(second?.cached).toBe(true);
    expect(second?.commonMisconceptions).toHaveLength(2);
    expect(llm.generateStructured).toHaveBeenCalledTimes(1);
  });

  it("says when a card has no excerpt rather than leaving a blank", () => {
    expect(explainPrompt({ question: "Q", answer: "A", excerpt: null })).toContain(
      "written by hand",
    );
  });
});

describe("per-model calibration", () => {
  it("runs flash-lite in smaller batches and asks it for more", async () => {
    const fileId = db.select().from(sourceFiles).get()!.id;
    for (let i = 2; i <= 10; i++) {
      db.insert(sourceSlides)
        .values({ sourceFileId: fileId, index: i, rawText: `Slide ${i}` })
        .run();
    }
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { llm, requests } = provider("gemini-3.1-flash-lite", { cards: [] });

    await generateCardsForExam(db, llm, examId, { density: "standard" });

    // Ten pages at eight a batch.
    expect(requests).toHaveLength(2);
    // Standard is 1 a page; this model follows a stated target literally and
    // under-delivers on prose, so it is told 2.
    expect(requests[0].system).toContain("roughly 2 cards per slide");
  });

  it("estimates from the running model's measured yield", () => {
    expect(expectedFor("standard", null, "gemini-3.1-flash-lite")).toBe(
      calibrationFor("gemini-3.1-flash-lite").expectedPerUnit.standard,
    );
    // A model nobody has measured falls back to the first calibration.
    expect(calibrationFor("some-new-model")).toBe(calibrationFor("gemini-2.5-flash"));
  });
});

describe("model fallback", () => {
  it("recognises a retired model, and nothing else", () => {
    expect(
      isModelUnavailable(
        new Error(
          '{"error":{"code":404,"message":"This model models/gemini-2.5-flash-lite is no longer available to new users.","status":"NOT_FOUND"}}',
        ),
      ),
    ).toBe(true);
    expect(
      isModelUnavailable(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}')),
    ).toBe(false);
  });
});
