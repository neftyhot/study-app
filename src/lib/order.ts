/**
 * The one order cards are shown in: the order the course taught them.
 *
 * Slideshow 1 before Slideshow 2 (by upload), then slide by slide, then the
 * order the cards were written from that slide. Never alphabetical by topic —
 * a deck sorted A→Z puts "Action potentials" before "What is a neuron?".
 *
 * The three columns are kept current by triggers (migration 0021); this module
 * is the read side, so every query and in-memory sort agrees.
 */
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import type { Db } from "@/db/client";
import {
  flashcards,
  studyGuideObjectives,
  type StudyGuideObjective,
} from "@/db/schema";

/**
 * ORDER BY for any query over `flashcards`. Cards without a slide sort after
 * the ones that have one; `created_at` breaks the last ties so the order is
 * total and stable across reloads.
 */
export function chronologicalCardOrder(): SQL[] {
  return [
    sql`${flashcards.sourceDocumentIndex} asc nulls last`,
    sql`${flashcards.sourcePageNumber} asc nulls last`,
    asc(flashcards.documentOrderIndex),
    asc(flashcards.createdAt),
  ];
}

export interface ChronologicalKey {
  sourceDocumentIndex: number | null;
  sourcePageNumber: number | null;
  documentOrderIndex: number;
  createdAt?: string;
}

function nullsLast(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** The same order as {@link chronologicalCardOrder}, for arrays in memory. */
export function compareChronological(a: ChronologicalKey, b: ChronologicalKey): number {
  return (
    nullsLast(a.sourceDocumentIndex, b.sourceDocumentIndex) ||
    nullsLast(a.sourcePageNumber, b.sourcePageNumber) ||
    a.documentOrderIndex - b.documentOrderIndex ||
    (a.createdAt ?? "").localeCompare(b.createdAt ?? "")
  );
}

/**
 * The number in a study-guide label: "7" → 7, "Question 12" → 12, "Q3b" → 3.
 * Null when there is none ("A", "Bonus"), so those sort after numbered items.
 */
export function questionNumber(label: string | null | undefined): number | null {
  const match = label?.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export interface ObjectiveKey {
  /** Upload rank of the study guide the item came from, when there are several. */
  fileRank?: number;
  label: string | null;
  orderIndex: number;
}

/**
 * Study-guide items by question number, so "Question 10" follows "Question 9"
 * rather than "Question 1". Items without a number keep the position they had
 * in the guide, after the numbered ones; within a guide, a repeated number
 * also falls back to that position.
 */
export function compareObjectives(a: ObjectiveKey, b: ObjectiveKey): number {
  return (
    (a.fileRank ?? 0) - (b.fileRank ?? 0) ||
    nullsLast(questionNumber(a.label), questionNumber(b.label)) ||
    a.orderIndex - b.orderIndex
  );
}

/** "Slideshow 2" — the name the app gives a document by its upload position. */
export function documentLabel(index: number | null | undefined): string {
  return index ? `Slideshow ${index}` : "Unsourced";
}

/** "Slideshow 1 · Slide 14" */
export function citationLabel(
  documentIndex: number | null | undefined,
  slideNumber: number | null | undefined,
): string {
  if (!documentIndex) return slideNumber ? `Slide ${slideNumber}` : "Unsourced";
  return slideNumber
    ? `${documentLabel(documentIndex)} · Slide ${slideNumber}`
    : documentLabel(documentIndex);
}

/**
 * ORDER BY that puts rows in the upload order of the file they belong to, for
 * tables that hold a `source_file_id`. File ids are random UUIDs, so ordering
 * by the id itself shuffles the slideshows.
 */
export function fileUploadOrder(fileId: SQLiteColumn): SQL[] {
  return [
    sql`(SELECT f.created_at FROM source_files f WHERE f.id = ${fileId}) asc nulls last`,
    sql`(SELECT f.rowid FROM source_files f WHERE f.id = ${fileId}) asc nulls last`,
  ];
}

/**
 * Study-guide items in question-number order. Expects rows already in the
 * upload order of their guides (see {@link fileUploadOrder}): each guide keeps
 * its place, and items are numbered within it.
 */
export function sortObjectives<
  T extends { sourceFileId: string | null; label: string | null; orderIndex: number },
>(rows: readonly T[]): T[] {
  const rank = new Map<string | null, number>();
  for (const row of rows) {
    if (!rank.has(row.sourceFileId)) rank.set(row.sourceFileId, rank.size);
  }
  return [...rows].sort((a, b) =>
    compareObjectives(
      { fileRank: rank.get(a.sourceFileId), label: a.label, orderIndex: a.orderIndex },
      { fileRank: rank.get(b.sourceFileId), label: b.label, orderIndex: b.orderIndex },
    ),
  );
}

/** An exam's study-guide objectives that are still in play, in guide order. */
export function loadObjectives(db: Db, examId: string): StudyGuideObjective[] {
  const rows = db
    .select()
    .from(studyGuideObjectives)
    .where(
      and(
        eq(studyGuideObjectives.examId, examId),
        eq(studyGuideObjectives.excluded, false),
      ),
    )
    .orderBy(
      ...fileUploadOrder(studyGuideObjectives.sourceFileId),
      studyGuideObjectives.orderIndex,
    )
    .all();
  return sortObjectives(rows);
}
