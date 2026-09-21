/**
 * What the tutor is allowed to return.
 *
 * The reply is prose, but it still arrives inside a schema (ARCHITECTURE
 * principle #2). That is not a formality: it lets one round trip carry the
 * answer, the follow-ups worth asking next, and a flag for "your material does
 * not actually say" — and it means a malformed response fails at the boundary
 * instead of halfway through rendering.
 */
import type { JsonSchema } from "@/lib/llm";

export const TUTOR_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description:
        "The answer, in Markdown. Use $...$ for inline maths and $$...$$ for display maths.",
    },
    suggestions: {
      type: "array",
      items: { type: "string" },
      description:
        "Up to three short follow-up questions this student would sensibly ask next.",
    },
    beyondMaterial: {
      type: "boolean",
      description:
        "True when the answer draws on knowledge the shown material does not contain.",
    },
  },
  required: ["reply", "beyondMaterial"],
  additionalProperties: false,
};

export type TutorResponse = {
  reply: string;
  suggestions?: string[];
  beyondMaterial: boolean;
};

export const CARD_EXTRACTION_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      description: "One entry per discrete, independently testable fact.",
      items: {
        type: "object",
        properties: {
          topic: { type: "string", description: "The concept this card belongs to." },
          question: {
            type: "string",
            description: "One question testing exactly one fact. Never compound.",
          },
          directAnswer: {
            type: "string",
            description: "The concise answer, one or two sentences.",
          },
          fullExplanation: {
            type: "string",
            description: "Optional expanded context. Empty string if nothing to add.",
          },
          essentialPoints: {
            type: "array",
            items: { type: "string" },
            description: "Points a typed answer MUST contain to be correct.",
          },
          commonMisconceptions: {
            type: "array",
            items: { type: "string" },
            description: "Plausible wrong answers, especially reversed directionality.",
          },
          fromMaterial: {
            type: "boolean",
            description:
              "True only if this card's answer is stated in the material shown, rather than added from general knowledge.",
          },
        },
        required: [
          "topic",
          "question",
          "directAnswer",
          "essentialPoints",
          "fromMaterial",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["cards"],
  additionalProperties: false,
};

export type ExtractedCard = {
  topic: string;
  question: string;
  directAnswer: string;
  fullExplanation?: string;
  essentialPoints: string[];
  commonMisconceptions?: string[];
  fromMaterial: boolean;
};

export type CardExtraction = { cards: ExtractedCard[] };
