/**
 * Tutor tests.
 *
 * The interesting cases are the refusals. A text-only model asked about a
 * diagram must say so rather than answer around the picture it never saw, and
 * a card that came from the model rather than from the lecture material has to
 * be stored as such — a deck whose provenance is unclear is worse than a
 * smaller one.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { cardRubrics, courses, exams, flashcards } from "@/db/schema";
import type { ChatRequest, LlmProvider } from "@/lib/llm";

import { askTutor, extractCards, MAX_TURNS } from "./index";
import { saveTutorCards } from "./save";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function provider(
  response: unknown,
  overrides: Partial<LlmProvider> = {},
): { provider: LlmProvider; requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];

  return {
    requests,
    provider: {
      name: "stub",
      model: "stub-model",
      vision: true,
      generateStructured: vi.fn(),
      generateChat: vi.fn(async (request: ChatRequest) => {
        requests.push(request);
        return { data: response as never };
      }),
      ...overrides,
    },
  };
}

const IMAGE = { mimeType: "image/png", data: "AAAA" };

describe("askTutor", () => {
  it("returns the reply and at most three suggestions", async () => {
    const { provider: llm } = provider({
      reply: "The posterior pituitary stores it.",
      suggestions: ["a", "b", "c", "d"],
      beyondMaterial: false,
    });

    const answer = await askTutor(llm, [{ role: "user", text: "Where is ADH stored?" }]);

    expect(answer.reply).toContain("posterior pituitary");
    expect(answer.suggestions).toHaveLength(3);
    expect(answer.beyondMaterial).toBe(false);
  });

  it("refuses to answer about a picture a text-only model cannot see", async () => {
    const { provider: llm } = provider({ reply: "x", beyondMaterial: false }, {
      vision: false,
    });

    await expect(
      askTutor(llm, [{ role: "user", text: "What is this?", images: [IMAGE] }]),
    ).rejects.toThrow(/reads text, not pictures/);
  });

  it("still answers a text question on a text-only model", async () => {
    const { provider: llm } = provider(
      { reply: "Yes.", beyondMaterial: false },
      { vision: false },
    );

    await expect(
      askTutor(llm, [{ role: "user", text: "Is ADH a peptide?" }]),
    ).resolves.toMatchObject({ reply: "Yes." });
  });

  it("says so when a provider cannot hold a conversation at all", async () => {
    const llm: LlmProvider = {
      name: "old",
      model: "old",
      generateStructured: vi.fn(),
    };

    await expect(askTutor(llm, [{ role: "user", text: "hi" }])).rejects.toThrow(
      /cannot hold a conversation/,
    );
  });

  it("rejects an empty answer rather than showing a blank bubble", async () => {
    const { provider: llm } = provider({ reply: "   ", beyondMaterial: false });

    await expect(
      askTutor(llm, [{ role: "user", text: "?" }]),
    ).rejects.toThrow(/empty answer/);
  });

  it("sends only the recent turns, because every turn carries its images", async () => {
    const { provider: llm, requests } = provider({
      reply: "ok",
      beyondMaterial: false,
    });

    const many = Array.from({ length: MAX_TURNS + 6 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "model") as "user" | "model",
      text: `turn ${i}`,
    }));

    await askTutor(llm, many);

    expect(requests[0].turns).toHaveLength(MAX_TURNS);
    expect(requests[0].turns.at(-1)?.text).toBe(`turn ${many.length - 1}`);
  });
});

describe("extractCards", () => {
  it("drops a card with no question or no answer", async () => {
    const { provider: llm } = provider({
      cards: [
        { topic: "A", question: "Q1", directAnswer: "A1", essentialPoints: [], fromMaterial: true },
        { topic: "B", question: "", directAnswer: "A2", essentialPoints: [], fromMaterial: true },
        { topic: "C", question: "Q3", directAnswer: "  ", essentialPoints: [], fromMaterial: true },
      ],
    });

    const cards = await extractCards(llm, {
      turns: [{ role: "user", text: "make cards" }],
    });

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe("Q1");
  });

  it("honours the limit it was given, whatever the model returns", async () => {
    const { provider: llm, requests } = provider({
      cards: Array.from({ length: 30 }, (_, i) => ({
        topic: "T",
        question: `Q${i}`,
        directAnswer: "A",
        essentialPoints: [],
        fromMaterial: true,
      })),
    });

    const cards = await extractCards(llm, {
      turns: [{ role: "user", text: "make cards" }],
      limit: 3,
    });

    expect(cards).toHaveLength(3);
    expect(requests[0].turns.at(-1)?.text).toContain("at most 3 cards");
  });

  it("treats a missing provenance flag as not from the material", async () => {
    const { provider: llm } = provider({
      cards: [{ topic: "T", question: "Q", directAnswer: "A", essentialPoints: [] }],
    });

    const [card] = await extractCards(llm, {
      turns: [{ role: "user", text: "make cards" }],
    });

    expect(card.fromMaterial).toBe(false);
  });
});

describe("saveTutorCards", () => {
  let db: TestDb;
  let examId: string;

  beforeEach(() => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: "./drizzle" });

    const course = db.insert(courses).values({ title: "A&P" }).returning().get();
    examId = db
      .insert(exams)
      .values({ courseId: course.id, title: "Exam 1" })
      .returning()
      .get().id;
  });

  it("stores a tutor card as the student's own, with no invented excerpt", () => {
    saveTutorCards(db, {
      examId,
      cards: [
        {
          topic: "ADH",
          question: "Where is ADH stored?",
          directAnswer: "The posterior pituitary.",
          essentialPoints: ["posterior pituitary"],
          fromMaterial: true,
        },
      ],
    });

    const card = db.select().from(flashcards).get()!;
    expect(card.sourceExcerpt).toBeNull();
    // Saved deliberately, so regenerating the deck must not delete it.
    expect(card.isUserEdited).toBe(true);
    expect(card.hasAiSupplement).toBe(false);

    const rubric = db
      .select()
      .from(cardRubrics)
      .where(eq(cardRubrics.flashcardId, card.id))
      .get();
    expect(rubric?.essentialPoints).toEqual(["posterior pituitary"]);
  });

  it("flags a card the tutor supplied from its own knowledge", () => {
    saveTutorCards(db, {
      examId,
      cards: [
        {
          topic: "ADH",
          question: "Q",
          directAnswer: "A",
          essentialPoints: [],
          fromMaterial: false,
        },
      ],
    });

    expect(db.select().from(flashcards).get()?.hasAiSupplement).toBe(true);
  });

  it("writes nothing for an empty list", () => {
    expect(saveTutorCards(db, { examId, cards: [] })).toEqual([]);
    expect(db.select().from(flashcards).all()).toHaveLength(0);
  });
});
