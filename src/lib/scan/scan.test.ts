/**
 * Scanning notes: the estimate is shown before anything is sent, a model that
 * can't see pictures is refused without a call, and every card it makes is
 * marked as coming from a scan.
 */
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { cardRubrics, flashcards } from "@/db/schema";
import { insertDeck } from "@/lib/decks/insert";
import { LlmError, type LlmProvider } from "@/lib/llm";
import { SAMPLE_DECK } from "@/lib/sample/memory-deck";
import {
  MAX_SCAN_IMAGES,
  SCAN_TOPIC,
  cleanCards,
  estimateScan,
  saveScanCards,
  scanImage,
} from "@/lib/scan/scan";

const IMAGE = { mimeType: "image/jpeg", data: "AAAA" };

function fakeProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    name: "fake",
    model: "gemini-2.5-flash",
    generateStructured: vi.fn(),
    generateChat: vi.fn().mockResolvedValue({
      data: {
        cards: [
          { topic: "Cells", question: " What makes ATP? ", directAnswer: "Mitochondria", essentialPoints: ["mitochondria"], fromMaterial: true },
          { question: "", directAnswer: "dropped" },
          { question: "Unanswered?", directAnswer: "  " },
          { question: "Who?", directAnswer: "Hooke" },
        ],
      },
    }),
    ...overrides,
  } as LlmProvider;
}

describe("estimating a scan", () => {
  it("is one call per photo, capped at the limit", () => {
    expect(estimateScan("gemini-2.5-flash", 3).calls).toBe(3);
    expect(estimateScan("gemini-2.5-flash", 50).calls).toBe(MAX_SCAN_IMAGES);
    expect(estimateScan("gemini-2.5-flash", -1).calls).toBe(0);
  });

  it("prices a known model and scales with the photo count", () => {
    const one = estimateScan("gemini-2.5-flash", 1);
    const four = estimateScan("gemini-2.5-flash", 4);
    expect(one.cost).toBeGreaterThan(0);
    expect(four.cost).toBeCloseTo(one.cost! * 4, 10);
    expect(four.costLabel).toMatch(/\$/);
  });

  it("says so when the price is unknown", () => {
    expect(estimateScan("some-local-model", 2).cost).toBeNull();
  });
});

describe("reading a photo", () => {
  it("refuses a text-only model without calling it", async () => {
    const provider = fakeProvider({ vision: false });
    await expect(scanImage(provider, IMAGE)).rejects.toBeInstanceOf(LlmError);
    expect(provider.generateChat).not.toHaveBeenCalled();
  });

  it("refuses a provider with no chat call", async () => {
    await expect(scanImage(fakeProvider({ generateChat: undefined }), IMAGE)).rejects.toBeInstanceOf(LlmError);
  });

  it("sends the photo and keeps only complete cards", async () => {
    const provider = fakeProvider();
    const cards = await scanImage(provider, IMAGE);
    const request = vi.mocked(provider.generateChat!).mock.calls[0][0];
    expect(request.feature).toBe("scan");
    expect(request.turns[0].images).toEqual([IMAGE]);
    expect(cards.map((c) => c.question)).toEqual(["What makes ATP?", "Who?"]);
    expect(cards[1].topic).toBe(SCAN_TOPIC);
    expect(cards[1].fromMaterial).toBe(false);
  });

  it("caps how many cards one photo can add", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ question: `Q${i}`, directAnswer: "A" }));
    expect(cleanCards(many).length).toBe(15);
  });
});

describe("saving scanned cards", () => {
  let db: Db;
  let examId: string;

  beforeEach(() => {
    db = drizzle(new Database(":memory:"), { schema }) as unknown as Db;
    migrate(db, { migrationsFolder: "./drizzle" });
    examId = insertDeck(db, SAMPLE_DECK);
  });

  it("marks every card as from a scan and leaves the rest alone", () => {
    const cards = cleanCards([
      { question: "Q1", directAnswer: "A1", essentialPoints: ["a1"], fromMaterial: true },
      { question: "Q2", directAnswer: "A2" },
    ]);
    expect(saveScanCards(db, examId, cards)).toBe(2);

    const rows = db.select().from(flashcards).where(eq(flashcards.examId, examId)).all();
    const scanned = rows.filter((r) => r.fromScan);
    expect(scanned.map((r) => r.question).sort()).toEqual(["Q1", "Q2"]);
    expect(rows.length - scanned.length).toBe(SAMPLE_DECK.cards.length);
    expect(scanned.find((r) => r.question === "Q2")!.hasAiSupplement).toBe(true);
    expect(scanned.find((r) => r.question === "Q1")!.hasAiSupplement).toBe(false);
    const rubric = db.select().from(cardRubrics).where(eq(cardRubrics.flashcardId, scanned.find((r) => r.question === "Q1")!.id)).get();
    expect(rubric?.essentialPoints).toEqual(["a1"]);
  });

  it("does nothing for no cards", () => {
    expect(saveScanCards(db, examId, [])).toBe(0);
  });
});
