/**
 * Response schemas for in-session help (PRD §14).
 */
import type { JsonSchema } from "@/lib/llm";

export const ASSIST_KINDS = [
  "simpler",
  "example",
  "compare",
  "hint",
  "prerequisite",
  "source",
] as const;

export type AssistKind = (typeof ASSIST_KINDS)[number];

export const ASSIST_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    body: {
      type: "string",
      description: "The help itself, addressed to the student. Two or three sentences.",
    },
    usesOutsideKnowledge: {
      type: "boolean",
      description:
        "True if anything here is not stated in the material you were given.",
    },
  },
  required: ["body", "usesOutsideKnowledge"],
  additionalProperties: false,
};

export type AssistResponse = {
  body: string;
  usesOutsideKnowledge: boolean;
};

export const ERROR_CATEGORIES = [
  "missing_prerequisite",
  "term_confusion",
  "defective_question",
  "not_learned_yet",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const DIAGNOSIS_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    category: {
      type: "string",
      enum: [...ERROR_CATEGORIES],
      description: "The single best explanation for this pattern of answers.",
    },
    explanation: {
      type: "string",
      description:
        "One or two sentences naming what the answers have in common.",
    },
    suggestion: {
      type: "string",
      description: "One sentence: what the student should do next.",
    },
  },
  required: ["category", "explanation", "suggestion"],
  additionalProperties: false,
};

export type DiagnosisResponse = {
  category: ErrorCategory;
  explanation: string;
  suggestion: string;
};
