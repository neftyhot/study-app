/**
 * Response schemas for card generation.
 *
 * These are the contract the model must satisfy (ARCHITECTURE principle #2).
 * Provenance fields are `required` so a card without a citation cannot even be
 * well-formed — validation in `validate.ts` then checks the citation resolves to a real slide.
 */
import type { JsonSchema } from "@/lib/llm";

export const CARD_TYPES = [
  "atomic",
  "process",
  "integration",
  /** Higher-order questions (PRD §9), generated only when asked for. */
  "application",
] as const;

/**
 * Facets from PRD §2. The model picks the facet a card tests, which is what
 * makes "did we atomize this concept?" a checkable question rather than a
 * matter of taste.
 */
export const CARD_FACETS = [
  "origin",
  "trigger",
  "target",
  "mechanism",
  "regulation",
  "definition",
  "comparison",
  "exception",
  "example",
  "process_step",
  "process_sequence",
  "process_rationale",
  "process_summary",
  "integration",
  /* PRD §9 — only produced when application questions are switched on. */
  "perturbation",
  "directional_shift",
  "scenario",
] as const;

export type CardFacet = (typeof CARD_FACETS)[number];

/**
 * Two shapes for the same card.
 *
 * "lean" is what a bulk run asks for: the question, the answer, the points a
 * typed answer must hit, and the provenance that makes the card trustworthy.
 * "full" adds the expanded explanation and the misconception list.
 *
 * The difference is almost entirely output tokens, and output tokens are
 * almost entirely the wall-clock cost of a run: an explanation paragraph and
 * three misconceptions are several times the length of the card they belong
 * to. Lean is the default, and the missing parts are filled in per card, on
 * request, rather than for eight hundred cards nobody asked about.
 *
 * What lean does NOT drop is provenance. The excerpt and the citation are what
 * make a card checkable, and a faster way to produce unverifiable cards is not
 * an optimisation.
 */
export type GenerationDetail = "lean" | "full";

export function generatedCardSchema(
  detail: GenerationDetail = "lean",
  /** Study-guide runs tag each card with the objective it answers. */
  options: { objectives?: boolean } = {},
): JsonSchema {
  const schema = structuredClone(GENERATED_CARD_SCHEMA) as {
    properties: {
      cards: {
        items: {
          properties: Record<string, unknown>;
          required: string[];
        };
      };
    };
  };

  if (detail === "lean") {
    const item = schema.properties.cards.items;
    delete item.properties.fullExplanation;
    delete item.properties.hasAiSupplement;
    delete item.properties.optionalPoints;
    delete item.properties.commonMisconceptions;
    // Never stored: it steered the model's decomposition in exhaustive runs,
    // and a lean run is not asking for that decomposition.
    delete item.properties.facet;
    item.required = item.required.filter(
      (key) => key !== "hasAiSupplement" && key !== "facet",
    );
    item.required.push("professorEmphasis");

    (item.properties.essentialPoints as { description: string }).description =
      "Between one and three short points a typed answer MUST contain.";
  }

  if (options.objectives) {
    const item = schema.properties.cards.items;
    item.properties.objective = {
      type: "string",
      description:
        "The token of the study-guide objective this card answers, e.g. 'O3'.",
    };
    item.required.push("objective");
  }

  return schema as JsonSchema;
}

export const GENERATED_CARD_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      description: "One entry per discrete, independently testable fact.",
      items: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description:
              "The broad section of the material this card belongs to, e.g. 'Posterior pituitary' or 'Olfactory system' — not the single fact or term it tests. Cards from the same section share one topic.",
          },
          facet: {
            type: "string",
            enum: [...CARD_FACETS],
            description: "Which single aspect of the concept this card tests.",
          },
          cardType: { type: "string", enum: [...CARD_TYPES] },
          question: {
            type: "string",
            description:
              "One question testing exactly one fact. Never compound.",
          },
          directAnswer: {
            type: "string",
            description: "The concise answer, one or two sentences.",
          },
          fullExplanation: {
            type: "string",
            description:
              "Optional expanded context. Empty string if nothing to add.",
          },
          hasAiSupplement: {
            type: "boolean",
            description:
              "True if fullExplanation contains anything not stated in the source.",
          },
          slideCitation: {
            type: "string",
            description:
              "The citation token of the slide supporting this card, e.g. 'S7'.",
          },
          sourceExcerpt: {
            type: "string",
            description:
              "Text copied VERBATIM from the cited slide that supports the answer.",
          },
          essentialPoints: {
            type: "array",
            items: { type: "string" },
            description:
              "Points a typed answer MUST contain to be correct.",
          },
          optionalPoints: {
            type: "array",
            items: { type: "string" },
            description: "Peripheral details: credited but not required.",
          },
          commonMisconceptions: {
            type: "array",
            items: { type: "string" },
            description:
              "Plausible wrong answers, especially reversed directionality.",
          },
          professorEmphasis: {
            type: "boolean",
            description:
              "True only when the material itself flags this as important: 'know this', 'on the exam', a learning objective, or a speaker note stressing it.",
          },
        },
        required: [
          "topic",
          "facet",
          "cardType",
          "question",
          "directAnswer",
          "hasAiSupplement",
          "slideCitation",
          "sourceExcerpt",
          "essentialPoints",
        ],
        additionalProperties: false,
      },
    },
    // No free-text "not covered" list. Each batch sees a few pages, so it
    // reported everything those pages happen not to mention — 1,459 notes,
    // 7,000 words, for a 48-objective guide, paid for as output tokens. What
    // is actually uncovered is worked out after the run from the cards, in
    // `generateCardsForExam`, where every batch's answer is known.
  },
  required: ["cards"],
  additionalProperties: false,
};

export type GeneratedCard = {
  topic: string;
  /** Absent from lean runs. */
  facet?: CardFacet;
  cardType: (typeof CARD_TYPES)[number];
  question: string;
  directAnswer: string;
  fullExplanation?: string;
  hasAiSupplement: boolean;
  slideCitation: string;
  sourceExcerpt: string;
  essentialPoints: string[];
  optionalPoints?: string[];
  commonMisconceptions?: string[];
  professorEmphasis?: boolean;
  /** Study-guide runs only: the O-token of the objective answered. */
  objective?: string;
};

export type GenerationResponse = {
  cards: GeneratedCard[];
};
