/**
 * Marking a typed answer: an exact match first, then on meaning with a key,
 * falling back to key points when there is no key or the call fails.
 */
import type { LlmProvider } from "@megan/core/llm/types";
import { createKeywordGrader, exactAnswerGrade, type TypedGrade, type TypedRequest } from "@megan/core/learn/typed";
import { createSemanticGrader } from "@megan/core/grade/semantic";

export async function markTyped(ai: LlmProvider | null, request: TypedRequest): Promise<TypedGrade> {
  const exact = exactAnswerGrade(request);
  if (exact) return exact;
  if (ai) {
    try {
      return await createSemanticGrader(ai).grade(request);
    } catch {
      // Offline or out of quota: mark on key points instead.
    }
  }
  return createKeywordGrader(0.6).grade(request);
}

export const VERDICT_LABELS: Record<TypedGrade["verdict"], string> = {
  correct: "Correct",
  partial: "Partly right",
  incorrect: "Not quite",
};
