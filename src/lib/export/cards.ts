/**
 * One normalized view of a deck, shared by every export target.
 *
 * Anki, Quizlet, RemNote and CSV want the same facts arranged differently, so
 * the database is read once into a shape that owes nothing to any of them.
 * Each writer then does formatting only — no queries, no joins, no surprises
 * about which target happens to include the rubric.
 */
import { asc, eq, inArray } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  cardRubrics,
  exams,
  flashcards,
  sourceFiles,
  sourceSlides,
} from "@/db/schema";

export type ExportCard = {
  id: string;
  topic: string;
  question: string;
  directAnswer: string;
  fullExplanation: string;
  essentialPoints: string[];
  optionalPoints: string[];
  commonMisconceptions: string[];
  cardType: string;
  professorEmphasis: boolean;
  starred: boolean;
  /** "Slide 7 of lecture.pptx" — readable outside this app. */
  sourceLabel: string;
  sourceExcerpt: string;
  /** Absolute path to the slide image, when one was extracted. */
  imagePath: string | null;
};

export type DeckExport = {
  examId: string;
  title: string;
  cards: ExportCard[];
};

/** What a page of each format is called, so provenance reads naturally. */
function unitWord(fileType: string): string {
  if (fileType === "pptx") return "Slide";
  if (fileType === "pdf") return "Page";
  return "Section";
}

export type CollectOptions = {
  /** Limit to specific cards, e.g. the current selection. */
  cardIds?: string[];
  /** Excluded cards are left out of study, so they are left out of exports. */
  includeExcluded?: boolean;
};

export function collectDeckCards(
  db: Db,
  examId: string,
  options: CollectOptions = {},
): DeckExport | undefined {
  const exam = db.select().from(exams).where(eq(exams.id, examId)).get();
  if (!exam) return undefined;

  const rows = db
    .select({
      card: flashcards,
      slide: sourceSlides,
      file: sourceFiles,
    })
    .from(flashcards)
    .leftJoin(sourceSlides, eq(flashcards.sourceSlideId, sourceSlides.id))
    .leftJoin(sourceFiles, eq(sourceSlides.sourceFileId, sourceFiles.id))
    .where(eq(flashcards.examId, examId))
    .orderBy(asc(flashcards.topic), asc(flashcards.createdAt))
    .all();

  const wanted = options.cardIds ? new Set(options.cardIds) : null;
  const selected = rows.filter(
    (row) =>
      (wanted === null || wanted.has(row.card.id)) &&
      (options.includeExcluded || !row.card.excluded),
  );

  const ids = selected.map((row) => row.card.id);
  const rubrics =
    ids.length === 0
      ? []
      : db
          .select()
          .from(cardRubrics)
          .where(inArray(cardRubrics.flashcardId, ids))
          .all();
  const rubricByCard = new Map(rubrics.map((row) => [row.flashcardId, row]));

  return {
    examId,
    title: exam.title,
    cards: selected.map(({ card, slide, file }) => {
      const rubric = rubricByCard.get(card.id);

      return {
        id: card.id,
        topic: card.topic ?? "Untitled",
        question: card.question,
        directAnswer: card.directAnswer,
        fullExplanation: card.fullExplanation ?? "",
        essentialPoints: rubric?.essentialPoints ?? [],
        optionalPoints: rubric?.optionalPoints ?? [],
        commonMisconceptions: rubric?.commonMisconceptions ?? [],
        cardType: card.cardType,
        professorEmphasis: card.professorEmphasis,
        starred: card.starred,
        sourceLabel:
          slide && file
            ? `${unitWord(file.fileType)} ${slide.index} of ${file.filename}`
            : "",
        sourceExcerpt: card.sourceExcerpt ?? "",
        imagePath: slide?.imagePath ?? null,
      };
    }),
  };
}
