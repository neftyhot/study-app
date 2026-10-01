/**
 * Writing the wrong options for a practice paper's multiple choice.
 *
 * The deck-built options (`lib/learn/mcq`) borrow other cards' answers, and a
 * deck often asks one fact more than once: two cards on break-even revenue
 * put the same formula, worded twice, into one question's options, and no
 * student can pick between them. Borrowed answers also give the game away the
 * other way — an option that is plainly the answer to question 7 is easy to
 * rule out on question 3.
 *
 * So a paper asks the model for wrong answers written for each question: the
 * mistakes a student who half-knows the material would make. Each is checked
 * against the right answer and the others, and a question left short falls
 * back to the deck-built options rather than going without.
 */
import type { JsonSchema, LlmProvider } from "@/lib/llm";

export const OPTIONS_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      description: "Exactly one entry per question given, in the same order.",
      items: {
        type: "object",
        properties: {
          token: { type: "string", description: "The token given, e.g. 'Q3'." },
          wrong: {
            type: "array",
            description: "Three wrong answers to this question.",
            items: { type: "string" },
          },
        },
        required: ["token", "wrong"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

export type OptionsResponse = {
  questions: { token: string; wrong: string[] }[];
};

export const OPTIONS_SYSTEM = `You are writing the wrong options for multiple-choice exam questions set from a
student's own flashcards. Each question comes with its correct answer.

For each question, write three wrong answers. Each must be:

- Definitely wrong. Someone who knows the material must be able to rule it out
  with certainty. Never a rewording, abbreviation, partial version, or more
  detailed version of the correct answer, and never something that would also
  be marked right.
- Plausible. The mistake a student who half-knows the topic would make: a
  reversed relationship, a swapped numerator and denominator, the neighbouring
  concept it is confused with, a cost left out or counted twice, the opposite
  effect. Not a joke, not obviously off-topic.
- Written for this question. Not the answer to another question in the list.
- The same kind of thing as the correct answer, in the same form and about the
  same length: a formula for a formula, a dollar figure for a dollar figure
  (worked out from a believable slip), a short phrase for a short phrase.
- Different from the other two wrong answers in substance, not just wording.

Never write "all of the above", "none of the above", or an answer that hedges.
Do not mark which option is right or explain anything. Return one entry per
token given.`;

export type OptionsInput = {
  id: string;
  question: string;
  answer: string;
  /** The card's known wrong answers, offered as a starting point. */
  misconceptions: string[];
};

/** Fewer than this and the question keeps its deck-built options. */
export const MIN_WRITTEN = 2;

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!]+$/, "").trim();
}

/**
 * The written options worth keeping, at most three.
 *
 * Drops anything empty, any option that is the right answer or another
 * option over again, and anything so much longer than the right answer that
 * it would be ruled out by its length.
 */
export function acceptOptions(answer: string, written: readonly string[]): string[] {
  const taken = new Set([normalize(answer)]);
  const limit = Math.max(answer.trim().length * 2.5, 40);
  const kept: string[] = [];

  for (const raw of written) {
    const text = (raw ?? "").trim().replace(/\s+/g, " ");
    const key = normalize(text);
    if (!key || taken.has(key) || text.length > limit) continue;
    if (/\b(all|none) of the (above|options)\b/i.test(text)) continue;
    taken.add(key);
    kept.push(text);
    if (kept.length === 3) break;
  }

  return kept;
}

/**
 * Writes wrong options for a batch of questions.
 *
 * Returns options only for questions that got enough usable ones; the rest
 * are left to the deck, so a partial failure costs a few questions their
 * written options rather than the paper.
 */
export async function writeOptions(
  llm: LlmProvider,
  questions: OptionsInput[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (questions.length === 0) return result;

  const tokenized = questions.map((question, i) => ({
    token: `Q${i + 1}`,
    question,
  }));
  const byToken = new Map(tokenized.map((entry) => [entry.token.toLowerCase(), entry.question]));

  const prompt = `QUESTIONS\n${tokenized
    .map(({ token, question }) =>
      [
        `[${token}] ${question.question}`,
        `Correct answer: ${question.answer}`,
        ...(question.misconceptions.length > 0
          ? [`Known mistakes: ${question.misconceptions.join(" | ")}`]
          : []),
      ].join("\n"),
    )
    .join("\n\n")}`;

  const { data } = await llm.generateStructured<OptionsResponse>({
    feature: "exam_options",
    system: OPTIONS_SYSTEM,
    prompt,
    schema: OPTIONS_SCHEMA,
    temperature: 0.6,
    thinking: "low",
  });

  for (const entry of data.questions ?? []) {
    const key = entry.token?.trim().toLowerCase() ?? "";
    const original = byToken.get(key) ?? byToken.get((key.match(/q\d+/) ?? [""])[0]);
    if (!original) continue;

    const kept = acceptOptions(original.answer, entry.wrong ?? []);
    if (kept.length >= MIN_WRITTEN) result.set(original.id, kept);
  }

  return result;
}
