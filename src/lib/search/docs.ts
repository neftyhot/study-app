/**
 * The shape of a search result, and the filtering over it.
 *
 * Deliberately free of `server-only` and of any database import: the deck-level
 * search runs this in the browser over cards it already has, and the global
 * search runs it on the server over everything. One set of rules, two callers.
 */
import { search, snippet, type Match } from "./match";

export type ResultKind = "card" | "objective" | "source";

export type SearchDoc = {
  id: string;
  kind: ResultKind;
  haystack: string;
  /** What the row shows. */
  title: string;
  body: string;
  courseId: string;
  courseTitle: string;
  examId: string;
  examTitle: string;
  topic: string | null;
  cardType: string | null;
  starred: boolean;
  /** Progress state for a card; null for anything else. */
  state: string | null;
  href: string;
};

export type SearchFilters = {
  courseId?: string | null;
  examId?: string | null;
  kinds?: ResultKind[];
  cardType?: string | null;
  starred?: boolean;
  /** "unstudied" | "learning" | "retained" */
  progress?: string | null;
};

export type SearchResult = {
  doc: SearchDoc;
  kind: Match<SearchDoc>["kind"] | "semantic";
  score: number;
  snippet: string;
  /** Present for semantic hits: why the model matched it. */
  reason?: string;
};

export function applyFilters(
  docs: SearchDoc[],
  filters: SearchFilters,
): SearchDoc[] {
  return docs.filter((doc) => {
    if (filters.courseId && doc.courseId !== filters.courseId) return false;
    if (filters.examId && doc.examId !== filters.examId) return false;
    if (filters.kinds?.length && !filters.kinds.includes(doc.kind)) return false;
    if (filters.cardType && doc.cardType !== filters.cardType) return false;
    if (filters.starred && !doc.starred) return false;

    if (filters.progress) {
      if (doc.kind !== "card") return false;
      if (filters.progress === "unstudied" && doc.state !== "unstudied") return false;
      if (filters.progress === "retained" && doc.state !== "retained") return false;
      if (
        filters.progress === "learning" &&
        (doc.state === "unstudied" || doc.state === "retained")
      ) {
        return false;
      }
    }

    return true;
  });
}

export function runSearch(
  docs: SearchDoc[],
  query: string,
  filters: SearchFilters = {},
  limit = 60,
): SearchResult[] {
  const scoped = applyFilters(docs, filters);

  return search(scoped, query, { limit }).map((match) => ({
    doc: match.item,
    kind: match.kind,
    score: match.score,
    snippet: snippet(match.item.haystack, query),
  }));
}

