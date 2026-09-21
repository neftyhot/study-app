import { createKeywordGrader, type TypedAnswerGrader } from "@/lib/learn/typed";
import { getProvider } from "@/lib/llm";

import { readGradingStrictness } from "@/lib/settings";

import { createSemanticGrader } from "./semantic";

export * from "./schemas";
export { createSemanticGrader, reconcileGrade } from "./semantic";
export { GRADING_SYSTEM, gradingPrompt, tokenizePoints } from "./prompts";
export * from "./strictness";

/**
 * The grader the app uses.
 *
 * Falls back to the keyword stand-in when no provider is configured, rather
 * than failing the session — but the fallback marks its grades `provisional`
 * so the UI can say the answer was matched on keywords, not understood.
 */
export function getTypedGrader(): TypedAnswerGrader {
  try {
    return createSemanticGrader(getProvider(), {
      strictness: readGradingStrictness(),
      // 12/12 grading fixtures with thinking off as with it on, at a quarter
      // of the cost and a fraction of the wait (`npm run grade:check`).
      thinking: "minimal",
    });
  } catch {
    return createKeywordGrader();
  }
}
