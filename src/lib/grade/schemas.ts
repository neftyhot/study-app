/**
 * Response schema for semantic grading (PRD §7, ARCHITECTURE principle #2).
 *
 * The model reports points by the tokens it was given — P1, P2, O1 — never by
 * quoting them back. A token that does not resolve is dropped, so a grader
 * cannot credit a criterion that was never in the rubric.
 */
import type { JsonSchema } from "@/lib/llm";

import { ERROR_TYPES } from "@/lib/learn/typed";

export const VERDICTS = ["correct", "partial", "incorrect"] as const;

export const GRADE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      enum: [...VERDICTS],
      description:
        "correct = every required point met and no gate broken; partial = some met; incorrect = none met, or a gate broken.",
    },
    errorType: {
      type: "string",
      enum: [...ERROR_TYPES],
      description:
        "The single most serious problem with the answer, or 'none'.",
    },
    metPoints: {
      type: "array",
      items: { type: "string" },
      description:
        "Tokens of the required points the answer actually states, e.g. ['P1','P3'].",
    },
    missedPoints: {
      type: "array",
      items: { type: "string" },
      description: "Tokens of the required points the answer does not state.",
    },
    creditedOptional: {
      type: "array",
      items: { type: "string" },
      description: "Tokens of any optional points the answer volunteered.",
    },
    feedback: {
      type: "string",
      description:
        "One or two sentences to the student. Name the specific error, not 'incorrect'.",
    },
  },
  required: [
    "verdict",
    "errorType",
    "metPoints",
    "missedPoints",
    "creditedOptional",
    "feedback",
  ],
  additionalProperties: false,
};

export type GradeResponse = {
  verdict: (typeof VERDICTS)[number];
  errorType: (typeof ERROR_TYPES)[number];
  metPoints: string[];
  missedPoints: string[];
  creditedOptional: string[];
  feedback: string;
};
