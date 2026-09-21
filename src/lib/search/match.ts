/**
 * Matching, ranking and highlighting for search.
 *
 * Three layers, in the order they cost anything:
 *
 *  1. **Exact** — the phrase, literally, the way Cmd-F works. Instant, and
 *     the only layer that can say "this is definitely what you typed".
 *  2. **Lexical** — every word present, or the distinctive ones, ranked by
 *     inverse document frequency. Still instant, still local, and it catches
 *     most of what exact misses.
 *  3. **Semantic** — the configured model, asked only when the first two come
 *     up short, because it costs a call and several seconds.
 *
 * Pure, so the matching rules are testable without a database or a model.
 */
import { buildIdf, relevance, terms, type Idf } from "@/lib/coverage/candidates";

export type MatchKind = "exact" | "lexical";

export type Searchable = {
  id: string;
  /** Every piece of text this result can be found by. */
  haystack: string;
};

export type Match<T extends Searchable> = {
  item: T;
  kind: MatchKind;
  score: number;
  /** Where the literal phrase was found, for highlighting. */
  at: number | null;
};

export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the query is a literal substring of the text. */
export function exactIndex(haystack: string, query: string): number {
  const trimmed = normalize(query);
  if (!trimmed) return -1;
  return normalize(haystack).indexOf(trimmed);
}

/**
 * A quoted query means the phrase and nothing else.
 *
 * Someone who types quotes has told us they know what they are looking for,
 * and widening the search on them is not helpful.
 */
export function isQuoted(query: string): boolean {
  const trimmed = query.trim();
  return trimmed.length > 1 && /^".*"$/.test(trimmed);
}

export function unquote(query: string): string {
  return isQuoted(query) ? query.trim().slice(1, -1) : query;
}

export type SearchOptions = {
  limit?: number;
  /** Lexical results below this share of the query's weight are dropped. */
  minScore?: number;
};

/**
 * Searches a set of items, exact hits first.
 *
 * Exact matches always outrank lexical ones however strong the lexical score:
 * a result containing the typed words is what the person asked for, and
 * reordering it beneath a cleverer guess is how search loses trust.
 */
export function search<T extends Searchable>(
  items: readonly T[],
  query: string,
  options: SearchOptions = {},
): Match<T>[] {
  const raw = query.trim();
  if (!raw) return [];

  const { limit = 100, minScore = 0.45 } = options;
  const phrase = unquote(raw);
  const quoted = isQuoted(raw);

  const exact: Match<T>[] = [];
  const rest: T[] = [];

  for (const item of items) {
    const at = exactIndex(item.haystack, phrase);
    if (at === -1) rest.push(item);
    else exact.push({ item, kind: "exact", score: 1, at });
  }

  // Earlier in the text usually means more prominent — a title rather than a
  // footnote — so ties break that way.
  exact.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));

  if (quoted) return exact.slice(0, limit);

  const idf: Idf = buildIdf(items.map((item) => item.haystack));
  const lexical: Match<T>[] = [];

  for (const item of rest) {
    const score = relevance(phrase, item.haystack, idf);
    if (score >= minScore) lexical.push({ item, kind: "lexical", score, at: null });
  }

  lexical.sort((a, b) => b.score - a.score);

  return [...exact, ...lexical].slice(0, limit);
}

/**
 * Whether the model is worth asking.
 *
 * A query that already found what it was looking for does not need a model,
 * and a single word rarely needs interpreting — it is the long, vague,
 * sentence-shaped queries that local matching handles worst.
 */
export function shouldOfferSemantic(query: string, results: number): boolean {
  const words = terms(query).length;
  if (isQuoted(query)) return false;
  if (results === 0) return words > 0;
  return results < 5 && words >= 2;
}

export type Highlight = { text: string; hit: boolean };

/** Splits text around the query so a match can be marked in the UI. */
export function highlight(text: string, query: string): Highlight[] {
  const phrase = normalize(unquote(query));
  if (!phrase) return [{ text, hit: false }];

  const parts: Highlight[] = [];
  const lower = normalize(text);
  let cursor = 0;

  // `normalize` collapses whitespace, so indexes can drift on text with runs
  // of spaces. Falling back to the raw text keeps the slices honest.
  const source = lower.length === text.length ? text : text;

  while (cursor < source.length) {
    const found = lower.indexOf(phrase, cursor);
    if (found === -1) {
      parts.push({ text: source.slice(cursor), hit: false });
      break;
    }

    if (found > cursor) parts.push({ text: source.slice(cursor, found), hit: false });
    parts.push({ text: source.slice(found, found + phrase.length), hit: true });
    cursor = found + phrase.length;
  }

  return parts.filter((part) => part.text.length > 0);
}

/** A short window of text around the match, for a result row. */
export function snippet(text: string, query: string, width = 160): string {
  const at = exactIndex(text, unquote(query));
  if (at === -1) return text.slice(0, width).trim();

  const start = Math.max(0, at - Math.floor(width / 3));
  const end = Math.min(text.length, start + width);

  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}
