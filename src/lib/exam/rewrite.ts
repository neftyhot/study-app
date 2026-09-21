/**
 * Rewriting questions so a paper is not the deck (PRD §11).
 *
 * A student who has drilled a deck recognises its wording, and recognising a
 * wording is not knowing an answer. Every prompt is asked differently: same
 * fact, same difficulty, different sentence.
 *
 * The rewrite must not change what is being asked, so it is checked: a prompt
 * that comes back empty, or barely different, falls back to the original. A
 * paper with some familiar phrasing is worth more than one that quietly asks
 * something else.
 */
import type { JsonSchema, LlmProvider } from "@/lib/llm";

export const REWRITE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      description: "Exactly one entry per question given, in the same order.",
      items: {
        type: "object",
        properties: {
          token: { type: "string", description: "The token given, e.g. 'Q3'." },
          prompt: {
            type: "string",
            description:
              "The same question asked differently. Same fact, same difficulty.",
          },
        },
        required: ["token", "prompt"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

export type RewriteResponse = {
  questions: { token: string; prompt: string }[];
};

export const REWRITE_SYSTEM = `You are setting an exam from a student's own flashcards.

Ask each question differently from how the card asks it. The student has drilled
these cards and recognises their wording; recognising a wording is not knowing
the answer.

Keep the fact identical and the difficulty identical. Do not add a second thing
to answer, do not make it vaguer, and do not turn a recall question into a
recognition one. Changing "Where is ADH released from?" to "Name the structure
that releases ADH" is right. Changing it to "Describe the posterior pituitary"
is not — that is a different question.

Never include the answer in the question. Return one entry per token given.`;

/** How different a prompt must be before it counts as rewritten. */
const MIN_DIFFERENCE = 0.25;

function words(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Share of the original's words that the rewrite does not reuse. */
export function difference(original: string, rewritten: string): number {
  const before = new Set(words(original));
  if (before.size === 0) return 0;

  const after = new Set(words(rewritten));
  let shared = 0;
  for (const word of before) if (after.has(word)) shared += 1;

  return 1 - shared / before.size;
}

/**
 * True when a rewrite should be rejected.
 *
 * Empty, or essentially the same sentence, or long enough to suggest the model
 * has started explaining rather than asking.
 */
export function rejectRewrite(original: string, rewritten: string): boolean {
  const trimmed = rewritten.trim();
  if (trimmed.length < 8) return true;
  if (trimmed.length > original.length * 3 + 60) return true;
  return difference(original, trimmed) < MIN_DIFFERENCE;
}

export type RewriteInput = { id: string; question: string };

/**
 * Rewrites a batch of questions, falling back per question.
 *
 * Returns the original wording for anything the model declined to change
 * usefully, so a partial failure costs a little familiarity rather than the
 * whole paper.
 */
export async function rewriteQuestions(
  llm: LlmProvider,
  questions: RewriteInput[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (questions.length === 0) return result;

  const tokenized = questions.map((question, i) => ({
    token: `Q${i + 1}`,
    question,
  }));
  const byToken = new Map(tokenized.map((entry) => [entry.token.toLowerCase(), entry.question]));

  const prompt = `QUESTIONS\n${tokenized
    .map((entry) => `[${entry.token}] ${entry.question.question}`)
    .join("\n")}`;

  const { data } = await llm.generateStructured<RewriteResponse>({
    feature: "exam_rewrite",
    system: REWRITE_SYSTEM,
    prompt,
    schema: REWRITE_SCHEMA,
    temperature: 0.4,
    // Reading an answer off material already in the prompt: thinking first
    // was most of the cost and none of the quality (see Phase 23 in TASKS.md).
    thinking: "minimal",
  });

  for (const entry of data.questions ?? []) {
    const key = entry.token?.trim().toLowerCase() ?? "";
    const original = byToken.get(key) ?? byToken.get((key.match(/q\d+/) ?? [""])[0]);
    if (!original) continue;

    const rewritten = entry.prompt?.trim() ?? "";
    if (rejectRewrite(original.question, rewritten)) continue;

    result.set(original.id, rewritten);
  }

  return result;
}
