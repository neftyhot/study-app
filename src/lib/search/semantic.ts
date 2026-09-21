/**
 * Model-backed search (the "vague query" case).
 *
 * Local matching answers "where does it say this". This answers "where does it
 * explain the thing I can only half describe" — which is what a student
 * actually has when they cannot remember the term.
 *
 * Same discipline as every other model pass here: candidates are shortlisted
 * lexically so the prompt stays small, the model may only point at tokens it
 * was given, and anything that does not resolve is dropped.
 */
import { buildIdf, rank } from "@/lib/coverage/candidates";
import type { JsonSchema, LlmProvider } from "@/lib/llm";

/** Shortlist size. Small enough for a local model's context window. */
export const CANDIDATE_LIMIT = 40;

export type SemanticCandidate = {
  id: string;
  /** What the model reads: topic, question, answer. */
  text: string;
};

export const SEMANTIC_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      description: "Only entries that genuinely answer the question. May be empty.",
      items: {
        type: "object",
        properties: {
          card: { type: "string", description: "The token, e.g. 'C7'." },
          reason: {
            type: "string",
            description: "One short clause on why it matches. No preamble.",
          },
        },
        required: ["card", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

export type SemanticResponse = {
  results: { card: string; reason: string }[];
};

export const SEMANTIC_SYSTEM = `You are finding the cards in a student's own deck that answer what they
asked, including when they have described it loosely or used the wrong word.

Match on meaning. "The tube that carries urine from the kidney" should find a
card about the ureter even though neither word appears in the question.

Only list cards that genuinely answer what was asked. An empty list is the
right answer when nothing does — offering something vaguely related is worse
than nothing, because the student will assume their deck covers it.

Refer to cards only by the tokens given. Order the best match first.`;

export function candidatesFor(
  query: string,
  items: readonly SemanticCandidate[],
  limit = CANDIDATE_LIMIT,
): SemanticCandidate[] {
  const idf = buildIdf(items.map((item) => item.text));
  const ranked = rank(query, items, (item) => item.text, idf, {
    limit,
    minScore: 0,
  });

  // A query sharing no vocabulary with the deck still deserves candidates:
  // that is exactly the case the model is here for.
  return ranked.length > 0 ? ranked : items.slice(0, limit);
}

export function buildPrompt(
  query: string,
  candidates: { token: string; item: SemanticCandidate }[],
): string {
  const list = candidates
    .map(({ token, item }) => `[${token}] ${item.text}`)
    .join("\n");

  return `QUESTION
${query}

CARDS
${list}`;
}

export type SemanticHit = { id: string; reason: string };

export async function semanticSearch(
  llm: LlmProvider,
  query: string,
  items: readonly SemanticCandidate[],
): Promise<SemanticHit[]> {
  if (items.length === 0 || query.trim() === "") return [];

  const shortlist = candidatesFor(query, items);
  const tokenized = shortlist.map((item, i) => ({ token: `C${i + 1}`, item }));
  const byToken = new Map(tokenized.map(({ token, item }) => [token.toLowerCase(), item]));

  const { data } = await llm.generateStructured<SemanticResponse>({
    feature: "search",
    system: SEMANTIC_SYSTEM,
    prompt: buildPrompt(query, tokenized),
    schema: SEMANTIC_SCHEMA,
    temperature: 0,
    // Reading an answer off material already in the prompt: thinking first
    // was most of the cost and none of the quality (see Phase 23 in TASKS.md).
    thinking: "minimal",
  });

  const hits: SemanticHit[] = [];
  const seen = new Set<string>();

  for (const entry of data.results ?? []) {
    const key = entry.card?.trim().toLowerCase() ?? "";
    const item =
      byToken.get(key) ??
      byToken.get((key.match(/c\d+/) ?? [""])[0]);

    // A token we did not supply is an invented card; drop it rather than
    // showing a result that leads nowhere.
    if (!item || seen.has(item.id)) continue;

    seen.add(item.id);
    hits.push({ id: item.id, reason: entry.reason?.trim() ?? "" });
  }

  return hits;
}
