/**
 * Lexical retrieval for the coverage passes.
 *
 * "Which of these 300 cards answer this objective?" does not fit in a prompt,
 * and does not need to: a cheap term-overlap ranking narrows each objective to
 * a few dozen plausible cards and the model judges only those. Rare terms
 * carry the signal — every card in an endocrine deck says "hormone", only a
 * few say "aldosterone" — so terms are weighted by inverse document frequency.
 *
 * This is a filter, never a verdict. Ranking decides what the model looks at;
 * the model decides what counts as covered.
 */

/**
 * Question words and instruction verbs. A study-guide objective is mostly
 * made of these ("Describe the role of..."), and they match every card
 * equally, so leaving them in would flatten the ranking.
 */
const STOPWORDS = new Set(
  `a an and are as at be been but by can could do does explain describe
   discuss compare contrast define identify list name state outline summarize
   for from has have how in into is it its of on or that the their them then
   there these this those to was were what when where which who why will with
   within you your role effect effects following each between both also more
   than about after before during under over via using use used`
    .split(/\s+/)
    .filter(Boolean),
);

/** Crude singularization — enough to match "hormones" against "hormone". */
function singular(term: string): string {
  if (term.length > 4 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.length > 4 && term.endsWith("s") && !term.endsWith("ss")) {
    return term.slice(0, -1);
  }
  return term;
}

export function terms(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2 && !STOPWORDS.has(term))
    .map(singular);
}

export type Idf = { weight(term: string): number };

export function buildIdf(documents: string[]): Idf {
  const documentFrequency = new Map<string, number>();

  for (const document of documents) {
    for (const term of new Set(terms(document))) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const total = Math.max(documents.length, 1);
  const weights = new Map<string, number>();
  for (const [term, frequency] of documentFrequency) {
    weights.set(term, Math.log((total + 1) / (frequency + 1)) + 1);
  }

  // A term the corpus has never seen is maximally distinctive: if an objective
  // asks about something no card mentions, that absence should dominate the
  // score rather than be dismissed as a common word.
  const unseen = Math.log(total + 1) + 1;

  return { weight: (term) => weights.get(term) ?? unseen };
}

/**
 * Share of the query's term weight that the document accounts for, 0–1.
 * Normalizing by the query keeps scores comparable across objectives of very
 * different lengths, which is what makes a single threshold meaningful.
 */
export function relevance(query: string, document: string, idf: Idf): number {
  const queryTerms = new Set(terms(query));
  if (queryTerms.size === 0) return 0;

  const documentTerms = new Set(terms(document));
  let total = 0;
  let matched = 0;

  for (const term of queryTerms) {
    const weight = idf.weight(term);
    total += weight;
    if (documentTerms.has(term)) matched += weight;
  }

  return total === 0 ? 0 : matched / total;
}

export type RankOptions = { limit?: number; minScore?: number };

export function rank<T>(
  query: string,
  items: readonly T[],
  textOf: (item: T) => string,
  idf: Idf,
  options: RankOptions = {},
): T[] {
  const { limit = 24, minScore = 0 } = options;

  return items
    .map((item) => ({ item, score: relevance(query, textOf(item), idf) }))
    .filter((scored) => scored.score > minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((scored) => scored.item);
}

/** Symmetric similarity, for pairing slides across files (conflict detection). */
export function similarity(a: string, b: string, idf: Idf): number {
  return Math.min(relevance(a, b, idf), relevance(b, a, idf));
}
