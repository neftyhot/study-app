/**
 * Semantic grading of typed answers (PRD §7).
 *
 * The model judges meaning; this module decides what that judgement is allowed
 * to conclude. Same discipline as card provenance and coverage: a model can be
 * told the rules, it cannot be trusted to have followed them, so the gates that
 * matter are enforced in code afterwards.
 *
 * In particular a directionality or mechanism error forces "incorrect" here, no
 * matter what verdict came back. Those are the errors that pass for knowledge
 * and are not, and PRD §7 says they fail.
 */
import type { LlmProvider, ThinkingEffort } from "@/lib/llm";
import type {
  TypedAnswerGrader,
  TypedGrade,
  TypedRequest,
} from "@/lib/learn/typed";

import { gradingPrompt, GRADING_SYSTEM, tokenizePoints } from "./prompts";
import {
  DEFAULT_STRICTNESS,
  strictnessRules,
  type Strictness,
} from "./strictness";
import { GRADE_SCHEMA, type GradeResponse } from "./schemas";

type Points = ReturnType<typeof tokenizePoints>;

function resolve(tokens: string[] | undefined, pool: Points["required"]) {
  const index = new Map(
    pool.map((point) => [point.token.toLowerCase(), point.text]),
  );
  const found: string[] = [];

  for (const raw of tokens ?? []) {
    const key = raw.trim().toLowerCase();
    const direct = index.get(key);
    if (direct) {
      found.push(direct);
      continue;
    }
    // Tolerate "[P2]" and "P2 (site)" without accepting invented tokens.
    for (const token of key.match(/[po]\d+/g) ?? []) {
      const text = index.get(token);
      if (text) found.push(text);
    }
  }

  return [...new Set(found)];
}

/**
 * Turns a model's report into a verdict that cannot contradict itself.
 *
 * Exported because this, not the prompt, is where the grading guarantees live.
 */
export function reconcileGrade(
  response: GradeResponse,
  points: Points,
  options: { provisional?: boolean; strictness?: Strictness } = {},
): TypedGrade {
  const required = points.required.map((point) => point.text);

  const missed = resolve(response.missedPoints, points.required);
  const met = resolve(response.metPoints, points.required).filter(
    (point) => !missed.includes(point),
  );

  // A point the grader mentioned neither way has not been shown to be met.
  const unreported = required.filter(
    (point) => !met.includes(point) && !missed.includes(point),
  );
  const missedPoints = [...missed, ...unreported];

  const gateBroken =
    response.errorType === "directionality" || response.errorType === "mechanism";

  // Lenient marking accepts most of the rubric: at least half the required
  // points, and never an answer that broke a gate.
  const enough =
    options.strictness === "lenient"
      ? met.length > 0 && met.length >= Math.ceil(required.length / 2)
      : missedPoints.length === 0 && met.length > 0;

  const verdict: TypedGrade["verdict"] = gateBroken
    ? "incorrect"
    : enough
      ? "correct"
      : met.length > 0
        ? "partial"
        : "incorrect";

  const errorType: TypedGrade["errorType"] = gateBroken
    ? response.errorType
    : verdict === "correct"
      ? "none"
      : verdict === "partial"
        ? "incomplete"
        : response.errorType === "none"
          ? "unrelated"
          : response.errorType;

  return {
    verdict,
    metPoints: met,
    missedPoints,
    creditedOptional: resolve(response.creditedOptional, points.optional),
    errorType,
    feedback: response.feedback?.trim() || fallbackFeedback(verdict, errorType),
    provisional: options.provisional ?? false,
  };
}

function fallbackFeedback(
  verdict: TypedGrade["verdict"],
  errorType: TypedGrade["errorType"],
): string {
  if (verdict === "correct") return "Every required point is there.";
  if (errorType === "directionality") return "The direction is reversed.";
  if (errorType === "mechanism") return "The mechanism or site is not right.";
  if (verdict === "partial") return "Right as far as it goes — keep going.";
  return "That does not answer the question.";
}

export function createSemanticGrader(
  llm: LlmProvider,
  options: { strictness?: Strictness; thinking?: ThinkingEffort } = {},
): TypedAnswerGrader {
  const strictness = options.strictness ?? DEFAULT_STRICTNESS;

  return {
    name: `semantic (${llm.model}, ${strictness})`,

    async grade(request: TypedRequest): Promise<TypedGrade> {
      const points = tokenizePoints(request);

      // Nothing to judge; do not spend a call to find that out.
      if (request.answer.trim().length === 0) {
        return {
          verdict: "incorrect",
          metPoints: [],
          missedPoints: points.required.map((point) => point.text),
          creditedOptional: [],
          errorType: "unrelated",
          feedback: "No answer given.",
          provisional: false,
        };
      }

      const { data } = await llm.generateStructured<GradeResponse>({
        system: GRADING_SYSTEM + strictnessRules(strictness),
        prompt: gradingPrompt(request, points),
        schema: GRADE_SCHEMA,
        temperature: 0,
        thinking: options.thinking,
      });

      return reconcileGrade(data, points, { strictness });
    },
  };
}
