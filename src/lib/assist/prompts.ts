/**
 * Prompts for in-session help (PRD §14).
 *
 * Every aid is grounded in the card's own source material, for the same reason
 * card generation is: help that quietly invents physiology is worse than no
 * help, because the student cannot tell the difference. When an aid does reach
 * beyond the material it has to say so, and the UI badges it.
 *
 * The hint is the one that needs a hard rule — an aid that gives away the
 * answer is not a hint, it is the answer.
 */
import type { AssistKind } from "./schemas";

export const ASSIST_SYSTEM = `You are helping a student who is stuck on one flashcard, mid-session.

Ground everything in the source material you are given. If you use anything
beyond it, set usesOutsideKnowledge to true — the student will see that the
extra context did not come from their own notes.

Be brief: two or three sentences. Speak to the student, not about them. Do not
restate the question. Do not flatter and do not apologise.`;

export const HINT_RULE = `A hint POINTS AT the answer; it never contains it.

Do not state, spell, paraphrase, or translate any required point. Say what KIND
of thing the answer is, where in the process it sits, or what to think about
first. If the required points are "posterior pituitary" and "increases water
reabsorption", an acceptable hint is: "Think about which lobe of the pituitary
stores hormones made elsewhere, and which direction ADH pushes water." An
unacceptable hint names the lobe or the direction.`;

export type AssistContext = {
  question: string;
  directAnswer: string;
  fullExplanation?: string | null;
  essentialPoints: string[];
  sourceExcerpt?: string | null;
  sourceText?: string | null;
  /** Other cards on the same topic, for comparisons. */
  siblings?: { question: string; directAnswer: string }[];
};

const INSTRUCTIONS: Record<AssistKind, string> = {
  simpler: `Explain the ANSWER in the plainest language you can, as if to someone
meeting the topic today. Keep every fact, drop every bit of jargon you can
replace, and define the jargon you cannot.`,

  example: `Give ONE concrete example that makes this fact click — a specific
case, a number, a clinical situation. Prefer an example present in the source
material; if you must invent one, keep it simple and mark outside knowledge.`,

  compare: `Contrast this concept with the most confusable neighbouring concept
from the student's own deck, listed below. Name the one difference that
actually separates them.`,

  hint: `Give a hint.\n\n${HINT_RULE}`,

  prerequisite: `The student cannot answer this yet. Name the ONE simpler thing
they need to know first, and ask it as a short question they could answer now.
End with that question.`,

  source: "",
};

export function assistPrompt(
  kind: AssistKind,
  context: AssistContext,
): string {
  const parts = [
    INSTRUCTIONS[kind],
    "",
    `QUESTION\n${context.question}`,
    `ANSWER\n${context.directAnswer}`,
  ];

  if (context.essentialPoints.length > 0) {
    parts.push(
      `REQUIRED POINTS\n${context.essentialPoints.map((p) => `- ${p}`).join("\n")}`,
    );
  }

  if (context.fullExplanation) {
    parts.push(`FURTHER CONTEXT\n${context.fullExplanation}`);
  }

  if (context.sourceExcerpt || context.sourceText) {
    parts.push(
      `SOURCE MATERIAL\n${context.sourceExcerpt ?? ""}\n${context.sourceText ?? ""}`.trim(),
    );
  }

  if (kind === "compare" && context.siblings?.length) {
    parts.push(
      `OTHER CARDS IN THIS DECK\n${context.siblings
        .map((s) => `- ${s.question} → ${s.directAnswer}`)
        .join("\n")}`,
    );
  }

  return parts.join("\n\n");
}

/* ------------------------------------------------------------- Diagnosis */

export const DIAGNOSIS_SYSTEM = `You are working out WHY a student keeps missing one flashcard, from what
they actually wrote.

Choose one category:
- "term_confusion": they are answering with a neighbouring concept, or swapping
  two terms — the knowledge is there but attached to the wrong label.
- "missing_prerequisite": their answers show a gap in something more basic that
  this fact depends on.
- "defective_question": the question is ambiguous, asks for more than one thing,
  or its required points do not match what it asks. Their answers are
  reasonable readings of a bad question. Do not be shy about this one — a
  generated card can simply be wrong.
- "not_learned_yet": nothing systematic; they have not learned it yet.

Judge from the answers given, not from how many there are.`;

export function diagnosisPrompt(
  context: AssistContext & { answers: string[] },
): string {
  return `QUESTION
${context.question}

EXPECTED ANSWER
${context.directAnswer}

REQUIRED POINTS
${context.essentialPoints.map((point) => `- ${point}`).join("\n") || "(none recorded)"}

WHAT THE STUDENT WROTE, OLDEST FIRST
${context.answers.map((answer, i) => `${i + 1}. ${answer}`).join("\n")}`;
}
