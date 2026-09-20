/**
 * Card generation pipeline: source units -> LLM -> validated, stored cards.
 *
 * Like ingestion, this is a plain async function taking a `Db` and an
 * `LlmProvider`, so it is callable from a route, a script, or a future queue,
 * and testable with a stubbed provider rather than a live API key.
 */
import { and, eq, inArray, ne } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  cardRubrics,
  exams,
  flashcards,
  sourceFiles,
  sourceSlides,
  studyGuideObjectives,
  type SourceSlide,
  type StudyGuideObjective,
} from "@/db/schema";
import type { LlmProvider } from "@/lib/llm";

import {
  fullCoveragePrompt,
  GENERATION_SYSTEM,
  objectiveFocusPrompt,
} from "./prompts";
import {
  GENERATED_CARD_SCHEMA,
  type GenerationResponse,
} from "./schemas";
import { validateCards, type Rejection } from "./validate";

/**
 * Slides per model call. Small enough that the model attends to every slide
 * (atomization degrades badly on long inputs) and large enough that a concept
 * spanning a few slides usually stays in one batch.
 */
export const DEFAULT_BATCH_SIZE = 8;

export type GenerationProgress = {
  batchIndex: number;
  batchCount: number;
  accepted: number;
  rejected: number;
};

export type GenerationSummary = {
  mode: "objectives" | "files";
  batchCount: number;
  cardsCreated: number;
  cardsRejected: number;
  rejections: Rejection[];
  uncoveredNotes: string[];
};

export type GenerateOptions = {
  batchSize?: number;
  /** Restrict generation to these source files; defaults to all ready files. */
  sourceFileIds?: string[];
  onProgress?: (progress: GenerationProgress) => void;
};

export async function generateCardsForExam(
  db: Db,
  llm: LlmProvider,
  examId: string,
  options: GenerateOptions = {},
): Promise<GenerationSummary> {
  const exam = db.select().from(exams).where(eq(exams.id, examId)).get();
  if (!exam) throw new Error(`Exam ${examId} not found`);

  const slides = loadSlides(db, examId, options.sourceFileIds);
  if (slides.length === 0) {
    throw new Error(
      "No extracted slides for this exam. Upload and ingest sources first.",
    );
  }

  const objectives =
    exam.scopeMode === "objectives" ? loadObjectives(db, examId) : [];

  // Study-guide focus needs objectives to anchor to; without them the mode
  // would silently behave like full coverage, which is not what was asked for.
  if (exam.scopeMode === "objectives" && objectives.length === 0) {
    throw new Error(
      "This exam is set to study-guide focus but has no objectives. Upload a study guide, or switch the exam to full coverage.",
    );
  }

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const batches = batchSlides(slides, batchSize);

  // Deduplicate against what is already stored, so re-running generation adds
  // to the deck instead of duplicating it.
  const existingQuestions = new Set(
    db
      .select({ question: flashcards.question })
      .from(flashcards)
      .where(eq(flashcards.examId, examId))
      .all()
      .map((row) => row.question),
  );

  const rejections: Rejection[] = [];
  const uncoveredNotes: string[] = [];
  let cardsCreated = 0;

  for (const [batchIndex, batch] of batches.entries()) {
    const promptOptions = { includeApplication: exam.includeApplication };
    const prompt =
      exam.scopeMode === "objectives"
        ? objectiveFocusPrompt(batch, objectives, promptOptions)
        : fullCoveragePrompt(batch, promptOptions);

    const { data } = await llm.generateStructured<GenerationResponse>({
      system: GENERATION_SYSTEM,
      prompt,
      schema: GENERATED_CARD_SCHEMA,
      temperature: 0,
    });

    const result = validateCards(data.cards ?? [], batch, {
      existingQuestions,
    });

    for (const validated of result.accepted) {
      existingQuestions.add(validated.card.question);
    }
    rejections.push(...result.rejected);
    uncoveredNotes.push(...(data.uncoveredNotes ?? []));

    cardsCreated += persistCards(db, examId, result.accepted);

    options.onProgress?.({
      batchIndex,
      batchCount: batches.length,
      accepted: result.accepted.length,
      rejected: result.rejected.length,
    });
  }

  return {
    mode: exam.scopeMode,
    batchCount: batches.length,
    cardsCreated,
    cardsRejected: rejections.length,
    rejections,
    uncoveredNotes,
  };
}

/**
 * Clears a deck's generated cards so it can be regenerated from scratch.
 *
 * Cards the student edited are kept: regenerating is a request to redo the
 * model's work, not theirs. Their rubrics, progress and coverage rows go with
 * the cards that are removed, by cascade.
 */
export function clearGeneratedCards(db: Db, examId: string) {
  const cards = db
    .select({ id: flashcards.id, isUserEdited: flashcards.isUserEdited })
    .from(flashcards)
    .where(eq(flashcards.examId, examId))
    .all();

  const generated = cards.filter((card) => !card.isUserEdited).map((c) => c.id);

  if (generated.length > 0) {
    db.delete(flashcards).where(inArray(flashcards.id, generated)).run();
  }

  return { deleted: generated.length, kept: cards.length - generated.length };
}

/** Writes cards and their rubrics. Never updates or deletes existing rows. */
function persistCards(
  db: Db,
  examId: string,
  accepted: ReturnType<typeof validateCards>["accepted"],
): number {
  if (accepted.length === 0) return 0;

  db.transaction((tx) => {
    for (const { card, slide } of accepted) {
      const [inserted] = tx
        .insert(flashcards)
        .values({
          examId,
          topic: card.topic,
          question: card.question,
          directAnswer: card.directAnswer,
          fullExplanation: card.fullExplanation || null,
          cardType: card.cardType,
          sourceSlideId: slide.id,
          sourceExcerpt: card.sourceExcerpt,
          hasAiSupplement: card.hasAiSupplement,
        })
        .returning({ id: flashcards.id })
        .all();

      tx.insert(cardRubrics)
        .values({
          flashcardId: inserted.id,
          essentialPoints: card.essentialPoints ?? [],
          optionalPoints: card.optionalPoints ?? [],
          commonMisconceptions: card.commonMisconceptions ?? [],
        })
        .run();
    }
  });

  return accepted.length;
}

function loadSlides(
  db: Db,
  examId: string,
  sourceFileIds?: string[],
): SourceSlide[] {
  const files = db
    .select({ id: sourceFiles.id })
    .from(sourceFiles)
    .where(
      and(
        eq(sourceFiles.examId, examId),
        eq(sourceFiles.status, "ready"),
        // Slides and notes both supply answers (PRD §1); a study guide defines
        // the objectives instead, so it is never used as answer material.
        ne(sourceFiles.role, "study_guide"),
      ),
    )
    .all()
    .map((row) => row.id)
    .filter((id) => !sourceFileIds || sourceFileIds.includes(id));

  if (files.length === 0) return [];

  return db
    .select()
    .from(sourceSlides)
    .where(inArray(sourceSlides.sourceFileId, files))
    .orderBy(sourceSlides.sourceFileId, sourceSlides.index)
    .all()
    // Slides with no usable text cannot support a card; skipping them keeps
    // them out of the prompt without hiding them from the legibility report.
    .filter((slide) => slide.legibilityFlag !== "empty");
}

function loadObjectives(db: Db, examId: string): StudyGuideObjective[] {
  return db
    .select()
    .from(studyGuideObjectives)
    .where(
      and(
        eq(studyGuideObjectives.examId, examId),
        eq(studyGuideObjectives.excluded, false),
      ),
    )
    .orderBy(studyGuideObjectives.orderIndex)
    .all();
}

/**
 * Batches never span source files.
 *
 * Citation tokens are `S<index>`, so slide 3 of a deck and page 3 of a set of
 * notes would both render as "[S3]" in one prompt — ambiguous to the model and
 * a collision in the map that resolves a citation back to a real slide.
 * Grouping by file keeps every token unique within the batch it belongs to.
 */
function batchSlides(slides: SourceSlide[], size: number): SourceSlide[][] {
  const byFile = new Map<string, SourceSlide[]>();
  for (const slide of slides) {
    const group = byFile.get(slide.sourceFileId) ?? [];
    group.push(slide);
    byFile.set(slide.sourceFileId, group);
  }

  return [...byFile.values()].flatMap((group) => chunk(group, size));
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
