/**
 * Grading prompt (PRD §7).
 *
 * Two jobs pulling in opposite directions: be generous about wording, and be
 * unforgiving about meaning. A student who writes "kidneys hold onto more
 * water" has answered "increases water reabsorption by the kidneys". A student
 * who writes "decreases water reabsorption" has not, and no amount of correct
 * surrounding detail changes that.
 */
import type { TypedRequest } from "@/lib/learn/typed";

export const GRADING_SYSTEM = `You grade a student's typed answer against a rubric. You are marking
understanding, not spelling.

ACCEPT
- Synonyms and paraphrase: "kidneys retain more water" answers "increases water
  reabsorption by the kidneys".
- Standard abbreviations and alternative names: ADH / vasopressin, RAAS, ACE.
- Misspellings and typos where the intended term is unambiguous.
- Any order, any phrasing, and answers that are shorter than the model answer.
  Brevity is not an omission if the point is made.

REJECT, ALWAYS
Two kinds of error are never partial credit, no matter how much else the answer
gets right:
- DIRECTIONALITY: increase vs. decrease, rise vs. fall, stimulate vs. inhibit,
  more vs. less, retain vs. excrete, hyper- vs. hypo-. Report errorType
  "directionality".
- MECHANISM: synthesis vs. secretion vs. release vs. transport; the wrong site,
  cell type, receptor, or step. Report errorType "mechanism".
An answer containing either is "incorrect", not "partial".

OTHERWISE
- "correct" when every required point is stated and no gate above is broken.
- "partial" when some required points are stated and none is contradicted.
- "incorrect" when no required point is stated ("unrelated"), or the answer is
  an admission of not knowing.
- Use errorType "incomplete" for a partial answer that is right as far as it goes.

RULES
- Credit a point only if the answer actually states it. Do not infer what the
  student probably meant, and do not credit a point because a neighbouring one
  was right.
- Refer to points only by the tokens given (P1, O2). Never invent a token.
- Feedback speaks to the student and names the specific problem: "You have the
  site right but reversed the direction — aldosterone increases sodium
  reabsorption." Never just "incorrect".`;

export type TokenizedPoint = { token: string; text: string };

export function tokenizePoints(request: TypedRequest): {
  required: TokenizedPoint[];
  optional: TokenizedPoint[];
} {
  // Drilling a subset: only the missed points are required this time.
  const requiredText =
    request.focusPoints && request.focusPoints.length > 0
      ? request.focusPoints
      : request.essentialPoints.length > 0
        ? request.essentialPoints
        : [request.expected];

  return {
    required: requiredText.map((text, i) => ({ token: `P${i + 1}`, text })),
    optional: (request.optionalPoints ?? []).map((text, i) => ({
      token: `O${i + 1}`,
      text,
    })),
  };
}

export function gradingPrompt(
  request: TypedRequest,
  points: ReturnType<typeof tokenizePoints>,
): string {
  const required = points.required
    .map((point) => `[${point.token}] ${point.text}`)
    .join("\n");

  const optional =
    points.optional.length > 0
      ? `\nOPTIONAL POINTS (credit, never required)\n${points.optional
          .map((point) => `[${point.token}] ${point.text}`)
          .join("\n")}`
      : "";

  const traps =
    request.misconceptions && request.misconceptions.length > 0
      ? `\nKNOWN WRONG ANSWERS for this question — if the student's answer means
any of these, it is incorrect:\n${request.misconceptions
          .map((item) => `- ${item}`)
          .join("\n")}`
      : "";

  const drill =
    request.focusPoints && request.focusPoints.length > 0
      ? `\nThe student is practising only the points they missed earlier, so
grade ONLY the required points listed above.`
      : "";

  return `QUESTION
${request.question}

MODEL ANSWER
${request.expected}

REQUIRED POINTS
${required}${optional}${traps}${drill}

STUDENT'S ANSWER
${request.answer}`;
}
