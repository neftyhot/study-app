/** Search across every deck, with the desktop's matcher. */
import type { SqlDriver } from "@megan/core/platform/types";
import { search, type MatchKind } from "@megan/core/search/match";

export type SearchHit = {
  cardId: string;
  examId: string;
  deck: string;
  question: string;
  answer: string;
  starred: boolean;
  kind: MatchKind;
};

type Row = {
  id: string;
  exam_id: string;
  deck: string;
  question: string;
  direct_answer: string;
  topic: string | null;
  starred: number;
};

export async function searchCards(db: SqlDriver, query: string, limit = 60): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  const rows = await db.all<Row>(
    `SELECT f.id, f.exam_id, e.title AS deck, f.question, f.direct_answer, f.topic, f.starred
     FROM flashcards f JOIN exams e ON e.id = f.exam_id
     WHERE f.deleted_at IS NULL AND e.deleted_at IS NULL`,
  );
  const items = rows.map((row) => ({
    id: row.id,
    haystack: [row.question, row.direct_answer, row.topic ?? ""].join("\n"),
    hit: {
      kind: "lexical" as MatchKind,
      cardId: row.id,
      examId: row.exam_id,
      deck: row.deck,
      question: row.question,
      answer: row.direct_answer,
      starred: row.starred === 1,
    },
  }));
  return search(items, query, { limit }).map((match) => ({ ...match.item.hit, kind: match.kind }));
}
