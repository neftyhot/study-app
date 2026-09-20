/**
 * Response schemas for the coverage passes (ARCHITECTURE principle #2).
 *
 * All three passes answer with references to tokens we handed the model —
 * "O3", "C12", "S7" — never with free-text identifiers. Anything that does not
 * resolve to a row we supplied is dropped in `validate.ts`, so a confident
 * model cannot invent an objective, a card, or a slide.
 */
import type { JsonSchema } from "@/lib/llm";

export const COVERAGE_STATUSES = [
  "covered",
  "partially_covered",
  "missing",
] as const;

export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

export const SOURCE_SUPPORT_LEVELS = ["answers", "partial", "silent"] as const;

export type SourceSupport = (typeof SOURCE_SUPPORT_LEVELS)[number];

/* ------------------------------------------------ Pass 1: cards→objectives */

export const COVERAGE_MAPPING_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    objectives: {
      type: "array",
      description: "Exactly one entry per objective you were given.",
      items: {
        type: "object",
        properties: {
          objective: {
            type: "string",
            description: "The objective token, e.g. 'O3'.",
          },
          status: {
            type: "string",
            enum: [...COVERAGE_STATUSES],
            description:
              "Whether the listed cards TOGETHER answer the objective.",
          },
          cards: {
            type: "array",
            description:
              "Only cards that genuinely help answer this objective. Empty if none do.",
            items: {
              type: "object",
              properties: {
                card: {
                  type: "string",
                  description: "The card token, e.g. 'C12'.",
                },
                status: {
                  type: "string",
                  enum: ["covered", "partially_covered"],
                  description:
                    "'covered' if this card alone answers the objective; otherwise 'partially_covered'.",
                },
              },
              required: ["card", "status"],
              additionalProperties: false,
            },
          },
          missingPoints: {
            type: "array",
            items: { type: "string" },
            description:
              "Specific things the objective asks for that no listed card answers.",
          },
          rationale: {
            type: "string",
            description: "One sentence explaining the status.",
          },
        },
        required: ["objective", "status", "cards", "missingPoints", "rationale"],
        additionalProperties: false,
      },
    },
  },
  required: ["objectives"],
  additionalProperties: false,
};

export type MappedCard = {
  card: string;
  status: "covered" | "partially_covered";
};

export type MappedObjective = {
  objective: string;
  status: CoverageStatus;
  cards: MappedCard[];
  missingPoints: string[];
  rationale: string;
};

export type CoverageMappingResponse = { objectives: MappedObjective[] };

/* ------------------------------------------- Pass 2: secondary source review */

export const COVERAGE_REVIEW_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    reviews: {
      type: "array",
      description: "Exactly one entry per objective you were given.",
      items: {
        type: "object",
        properties: {
          objective: { type: "string", description: "The objective token." },
          sourceSupport: {
            type: "string",
            enum: [...SOURCE_SUPPORT_LEVELS],
            description:
              "'answers' if the slides fully answer it, 'partial' if they answer part, 'silent' if they do not address it at all.",
          },
          slideCitation: {
            type: "string",
            description:
              "Token of the slide with the best supporting material, e.g. 'S4'. Empty string if none.",
          },
          sourceExcerpt: {
            type: "string",
            description:
              "Text copied VERBATIM from that slide. Empty string if sourceSupport is 'silent'.",
          },
          missingPoints: {
            type: "array",
            items: { type: "string" },
            description:
              "What the objective asks for that the slides do not contain.",
          },
          note: {
            type: "string",
            description: "One sentence for the student.",
          },
        },
        required: [
          "objective",
          "sourceSupport",
          "slideCitation",
          "sourceExcerpt",
          "missingPoints",
          "note",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["reviews"],
  additionalProperties: false,
};

export type ObjectiveReview = {
  objective: string;
  sourceSupport: SourceSupport;
  slideCitation: string;
  sourceExcerpt: string;
  missingPoints: string[];
  note: string;
};

export type CoverageReviewResponse = { reviews: ObjectiveReview[] };

/* ------------------------------------------------ Pass 3: conflict detection */

export const CONFLICT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    conflicts: {
      type: "array",
      description:
        "Only genuine contradictions. Empty array if the slides simply differ in wording or detail.",
      items: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "What the two statements disagree about.",
          },
          slideA: { type: "string", description: "Token of the first slide." },
          statementA: {
            type: "string",
            description: "Text copied VERBATIM from the first slide.",
          },
          slideB: { type: "string", description: "Token of the second slide." },
          statementB: {
            type: "string",
            description: "Text copied VERBATIM from the second slide.",
          },
          explanation: {
            type: "string",
            description: "Why both statements cannot be true.",
          },
        },
        required: [
          "topic",
          "slideA",
          "statementA",
          "slideB",
          "statementB",
          "explanation",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["conflicts"],
  additionalProperties: false,
};

export type DetectedConflict = {
  topic: string;
  slideA: string;
  statementA: string;
  slideB: string;
  statementB: string;
  explanation: string;
};

export type ConflictResponse = { conflicts: DetectedConflict[] };
