/**
 * Response schemas for card generation.
 *
 * These are the contract the model must satisfy (ARCHITECTURE principle #2).
 * Provenance fields are `required` so a card without a citation cannot even be
 * well-formed — validation in `validate.ts` then checks the citation resolves to a real slide.
 */
import type { JsonSchema } from "@/lib/llm";

export const CARD_TYPES = ["atomic", "process", "integration"] as const;

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
] as const;

export type CardFacet = (typeof CARD_FACETS)[number];

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
              "The concept this card belongs to, e.g. 'ADH' or 'Glycolysis'.",
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
    /** Lets the model report silence instead of inventing an answer. */
    uncoveredNotes: {
      type: "array",
      items: { type: "string" },
      description:
        "Concepts referenced by the material but not actually explained in it.",
    },
  },
  required: ["cards"],
  additionalProperties: false,
};

export type GeneratedCard = {
  topic: string;
  facet: CardFacet;
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
};

export type GenerationResponse = {
  cards: GeneratedCard[];
  uncoveredNotes?: string[];
};
