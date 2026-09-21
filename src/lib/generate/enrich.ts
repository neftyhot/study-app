/**
 * Filling in the parts a bulk run deliberately skipped.
 *
 * A lean run stops at the question, the answer and the points an answer must
 * contain, because the explanation and the misconception list are several
 * times their length and most of them are never read. This fills them in for
 * one card, when someone actually wants them.
 *
 * The same provenance rule applies: the explanation is written from the slide
 * the card already cites, and anything added beyond it is marked as added.
 */
import { eq } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  cardRubrics,
  flashcards,
  sourceSlides,
  type Flashcard,
} from "@/db/schema";
import type { JsonSchema, LlmProvider } from "@/lib/llm";

export const ENRICH_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    fullExplanation: {
      type: "string",
      description:
        "Two to four sentences explaining the mechanism behind the answer.",
    },
    hasAiSupplement: {
      type: "boolean",
      description:
        "True if the explanation contains anything not stated in the slide.",
    },
    commonMisconceptions: {
      type: "array",
      items: { type: "string" },
      description:
        "Up to three plausible wrong answers, especially reversed directionality.",
    },
    optionalPoints: {
      type: "array",
      items: { type: "string" },
      description: "Peripheral details worth credit but not required.",
    },
  },
  required: ["fullExplanation", "hasAiSupplement", "commonMisconceptions"],
  additionalProperties: false,
};

export type EnrichResponse = {
  fullExplanation: string;
  hasAiSupplement: boolean;
  commonMisconceptions: string[];
  optionalPoints?: string[];
};

export const ENRICH_SYSTEM = `You expand one flashcard the student is looking at.

- Explain the mechanism behind the answer in two to four sentences. Say why,
  not just what.
- Work from the slide text given. If you add anything the slide does not say,
  set hasAiSupplement to true.
- commonMisconceptions are plausible wrong answers a student would actually
  give — reversed directionality (increase vs. decrease) and mechanism mix-ups
  (synthesis vs. secretion) before anything else.
- Never contradict the card's answer. If the card looks wrong, explain what
  the slide says and let the student see the difference.`;

export type EnrichedCard = Flashcard & {
  commonMisconceptions: string[];
};

export async function enrichCard(
  db: Db,
  llm: LlmProvider,
  cardId: string,
): Promise<EnrichedCard | undefined> {
  const card = db.select().from(flashcards).where(eq(flashcards.id, cardId)).get();
  if (!card) return undefined;

  const slide = card.sourceSlideId
    ? db
        .select()
        .from(sourceSlides)
        .where(eq(sourceSlides.id, card.sourceSlideId))
        .get()
    : undefined;

  const { data } = await llm.generateStructured<EnrichResponse>({
    system: ENRICH_SYSTEM,
    prompt: [
      `QUESTION\n${card.question}`,
      `ANSWER\n${card.directAnswer}`,
      card.sourceExcerpt ? `CITED EXCERPT\n${card.sourceExcerpt}` : "",
      slide?.rawText ? `THE SLIDE IT CAME FROM\n${slide.rawText}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    schema: ENRICH_SCHEMA,
    temperature: 0.2,
    maxOutputTokens: 1024,
  });

  const explanation = data.fullExplanation?.trim();
  const misconceptions = (data.commonMisconceptions ?? []).filter(Boolean).slice(0, 3);

  db.transaction((tx) => {
    tx.update(flashcards)
      .set({
        fullExplanation: explanation || card.fullExplanation,
        hasAiSupplement: card.hasAiSupplement || data.hasAiSupplement === true,
      })
      .where(eq(flashcards.id, cardId))
      .run();

    const rubric = tx
      .select()
      .from(cardRubrics)
      .where(eq(cardRubrics.flashcardId, cardId))
      .get();

    if (rubric) {
      tx.update(cardRubrics)
        .set({
          commonMisconceptions:
            // Never overwrite misconceptions the deck already had: a full run
            // wrote those against the whole batch's context, which this call
            // does not have.
            rubric.commonMisconceptions.length > 0
              ? rubric.commonMisconceptions
              : misconceptions,
          optionalPoints:
            rubric.optionalPoints.length > 0
              ? rubric.optionalPoints
              : ((data.optionalPoints ?? []).filter(Boolean).slice(0, 3)),
        })
        .where(eq(cardRubrics.flashcardId, cardId))
        .run();
    } else {
      tx.insert(cardRubrics)
        .values({
          flashcardId: cardId,
          essentialPoints: [],
          optionalPoints: (data.optionalPoints ?? []).filter(Boolean).slice(0, 3),
          commonMisconceptions: misconceptions,
        })
        .run();
    }
  });

  const updated = db.select().from(flashcards).where(eq(flashcards.id, cardId)).get()!;
  const rubric = db
    .select()
    .from(cardRubrics)
    .where(eq(cardRubrics.flashcardId, cardId))
    .get();

  return { ...updated, commonMisconceptions: rubric?.commonMisconceptions ?? [] };
}
