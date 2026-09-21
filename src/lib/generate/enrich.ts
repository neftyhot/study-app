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
 *
 * It is written once. A card that already has an explanation — from a full
 * run, a previous request, or the student — is answered from SQLite without
 * a model call, so asking twice never costs twice.
 */
import { and, eq, isNull, or } from "drizzle-orm";

import type { Db } from "@/db/client";
import { cardRubrics, flashcards, sourceSlides } from "@/db/schema";
import type { JsonSchema, LlmProvider } from "@/lib/llm";
import { estimateCost, formatCost } from "@/lib/llm/pricing";

export const ENRICH_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    fullExplanation: {
      type: "string",
      description:
        "Exactly two short paragraphs, separated by a blank line: the mechanism behind the answer, then how it connects to the surrounding concept.",
    },
    hasAiSupplement: {
      type: "boolean",
      description:
        "True if the explanation contains anything not stated in the source excerpt or slide.",
    },
    commonMisconceptions: {
      type: "array",
      items: { type: "string" },
      description:
        "Exactly two plausible wrong answers, especially reversed directionality.",
    },
  },
  required: ["fullExplanation", "hasAiSupplement", "commonMisconceptions"],
  additionalProperties: false,
};

export type EnrichResponse = {
  fullExplanation: string;
  hasAiSupplement: boolean;
  commonMisconceptions: string[];
};

export const ENRICH_SYSTEM = `You expand one flashcard the student is looking at.

- Write a two-paragraph conceptual breakdown. Say why, not just what.
- Work from the source excerpt and slide text given. If you add anything they
  do not say, set hasAiSupplement to true.
- Give two common misconceptions: plausible wrong answers a student would
  actually give — reversed directionality (increase vs. decrease) and
  mechanism mix-ups (synthesis vs. secretion) before anything else.
- Never contradict the card's answer. If the card looks wrong, explain what
  the source says and let the student see the difference.`;

/** The user-turn prompt, kept separate so it can be tested without a model. */
export function explainPrompt(input: {
  question: string;
  answer: string;
  excerpt?: string | null;
  slideText?: string | null;
}): string {
  const lines = [
    `Given this question: ${input.question}`,
    `answer: ${input.answer}`,
    `and source excerpt: ${input.excerpt?.trim() || "(none — this card was written by hand)"}`,
    "provide a 2-paragraph conceptual breakdown and 2 common misconceptions.",
  ];

  if (input.slideText?.trim()) {
    lines.push("", `THE FULL SLIDE THE EXCERPT CAME FROM\n${input.slideText.trim()}`);
  }

  return lines.join("\n");
}

export type ExplainedCard = {
  cardId: string;
  fullExplanation: string | null;
  commonMisconceptions: string[];
  hasAiSupplement: boolean;
  /** True when this was read back from SQLite and no model was called. */
  cached: boolean;
};

/**
 * Returns a card's explanation, writing it first if it has none.
 *
 * `llm` is a function so a cached answer never needs a provider: a student
 * with no key, or offline, can still read every explanation already written.
 */
export async function explainCard(
  db: Db,
  llm: () => LlmProvider,
  cardId: string,
): Promise<ExplainedCard | undefined> {
  const card = db.select().from(flashcards).where(eq(flashcards.id, cardId)).get();
  if (!card) return undefined;

  if (card.fullExplanation?.trim()) {
    return {
      cardId,
      fullExplanation: card.fullExplanation,
      commonMisconceptions: misconceptionsOf(db, cardId),
      hasAiSupplement: card.hasAiSupplement,
      cached: true,
    };
  }

  const slide = card.sourceSlideId
    ? db
        .select()
        .from(sourceSlides)
        .where(eq(sourceSlides.id, card.sourceSlideId))
        .get()
    : undefined;

  const provider = llm();
  const { data, usage } = await provider.generateStructured<EnrichResponse>({
    system: ENRICH_SYSTEM,
    prompt: explainPrompt({
      question: card.question,
      answer: card.directAnswer,
      excerpt: card.sourceExcerpt,
      slideText: slide?.rawText,
    }),
    schema: ENRICH_SCHEMA,
    temperature: 0.2,
    // Reading an answer off material already in the prompt: thinking first
    // was most of the cost and none of the quality (see Phase 23 in TASKS.md).
    thinking: "minimal",
    // Generous on purpose: a thinking model spends this budget on its thinking
    // before the answer, and 1024 cut the JSON off mid-string on
    // gemini-2.5-flash. The answer itself is a few hundred tokens.
    maxOutputTokens: 8192,
  });

  if (usage) {
    const tokens = {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    };
    console.log(
      `[explain] ${cardId}: ${tokens.inputTokens} in / ${tokens.outputTokens} out tokens, ` +
        `${formatCost(estimateCost(provider.model, tokens))} on ${provider.model}`,
    );
  }

  const explanation = data.fullExplanation?.trim() || null;
  const misconceptions = (data.commonMisconceptions ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2);

  db.transaction((tx) => {
    // Only fills the gap: if the card gained an explanation while the model
    // was answering, that one wins.
    tx.update(flashcards)
      .set({
        fullExplanation: explanation,
        hasAiSupplement: card.hasAiSupplement || data.hasAiSupplement === true,
      })
      .where(
        and(
          eq(flashcards.id, cardId),
          or(isNull(flashcards.fullExplanation), eq(flashcards.fullExplanation, "")),
        ),
      )
      .run();

    const rubric = tx
      .select()
      .from(cardRubrics)
      .where(eq(cardRubrics.flashcardId, cardId))
      .get();

    if (rubric) {
      // Never overwrite misconceptions the card already had: a full run wrote
      // those against the whole batch's context, which this call does not have.
      if (rubric.commonMisconceptions.length === 0) {
        tx.update(cardRubrics)
          .set({ commonMisconceptions: misconceptions })
          .where(eq(cardRubrics.flashcardId, cardId))
          .run();
      }
    } else {
      tx.insert(cardRubrics)
        .values({
          flashcardId: cardId,
          essentialPoints: [],
          optionalPoints: [],
          commonMisconceptions: misconceptions,
        })
        .run();
    }
  });

  const updated = db.select().from(flashcards).where(eq(flashcards.id, cardId)).get()!;
  return {
    cardId,
    fullExplanation: updated.fullExplanation,
    commonMisconceptions: misconceptionsOf(db, cardId),
    hasAiSupplement: updated.hasAiSupplement,
    cached: false,
  };
}

function misconceptionsOf(db: Db, cardId: string): string[] {
  return (
    db
      .select({ items: cardRubrics.commonMisconceptions })
      .from(cardRubrics)
      .where(eq(cardRubrics.flashcardId, cardId))
      .get()?.items ?? []
  );
}
