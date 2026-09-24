/**
 * Card generation pipeline: source units -> LLM -> validated, stored cards.
 *
 * Like ingestion, this is a plain async function taking a `Db` and an
 * `LlmProvider`, so it is callable from a route, a script, or a future queue,
 * and testable with a stubbed provider rather than a live API key.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import pLimit from "p-limit";

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
import { estimateCost, formatCost } from "@/lib/llm/pricing";

import {
  ADMIN_MAX_RATIO,
  batchSizeFor,
  calibrationFor,
  isHighDensity,
  ratioFor,
  type DensityMode,
} from "./density";
import {
  fullCoveragePrompt,
  generationSystem,
  objectiveFocusPrompt,
  objectiveToken,
} from "./prompts";
import { describeRejection, type RejectionView } from "./rejections";
import { withRetry } from "./retry";
import { routeObjectives } from "./routing";
import {
  generatedCardSchema,
  type GenerationDetail,
  type GenerationResponse,
} from "./schemas";
import { validateCards, type Rejection } from "./validate";

/**
 * Slides per model call.
 *
 * Large enough that a 300-page deck is a couple of dozen requests rather than
 * forty, small enough that the model still attends to every slide — attention
 * to individual slides is what atomization depends on, and it degrades on very
 * long inputs. This is the knob that trades cards-per-slide against
 * wall-clock, so it is worth knowing which way you moved it.
 */
export const DEFAULT_BATCH_SIZE = 18;

/**
 * Requests in flight at once.
 *
 * Batches do not depend on each other, so the only reason to run them one at a
 * time is politeness to the provider's rate limit — and a 429 is handled by
 * backing off rather than by never asking.
 *
 * Measured on a real 314-page deck against gemini-2.5-flash: 5 at a time took
 * 198s, 20 at a time took 75s, and 30 at a time took 72s. Above one wave the
 * curve flattens because the wall-clock becomes one request's latency rather
 * than the number of requests — so the useful setting is "wide enough that
 * most decks finish in a single wave", and beyond that nothing is gained.
 */
export const DEFAULT_CONCURRENCY = 20;

export type GenerationProgress = {
  /**
   * Batches finished, not the position of the batch that just finished.
   *
   * With five requests in flight they complete out of order, so an index
   * would make the progress bar jump backwards.
   */
  batchIndex: number;
  batchCount: number;
  /** Totals so far, so a caller never has to accumulate them itself. */
  cardsCreated: number;
  cardsRejected: number;
  accepted: number;
  rejected: number;
};

export type GenerationSummary = {
  mode: "objectives" | "files";
  density: DensityMode;
  detail: GenerationDetail;
  /** Units actually sent to the model, after any range filtering. */
  unitsUsed: number;
  batchCount: number;
  cardsCreated: number;
  cardsRejected: number;
  /** Wall-clock for the whole run. */
  durationMs: number;
  /** Batches that failed outright, after their retries. */
  failedBatches: { batch: number; error: string }[];
  /** The model the batches ran on. */
  model: string;
  /**
   * Tokens across every batch that returned, and what they cost at the
   * model's published rate. Null cost means the rate is not known.
   */
  usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number | null };
  rejections: Rejection[];
  /**
   * Study-guide runs: objectives no accepted card was tagged with. Exact and
   * bounded by the guide — never more entries than it has objectives. Says
   * nothing about whether the material covers them; the coverage check does.
   */
  objectivesWithoutCards: { label: string | null; text: string }[];
  objectivesTotal: number;
  /** Each rejected card with what was on it and why, in plain words. */
  rejectionViews: RejectionView[];
};

/** 1-based, inclusive — the numbers the student sees in the original file. */
export type UnitRange = { from: number; to: number };

export type GenerateOptions = {
  batchSize?: number;
  /** Restrict generation to these source files; defaults to all ready files. */
  sourceFileIds?: string[];
  /**
   * Which pages of each file to use, keyed by source file id. A file with no
   * entry is used whole, so omitting this means "everything" as before.
   */
  ranges?: Record<string, UnitRange>;
  /** Overrides the density stored on the exam for this run. */
  density?: DensityMode;
  /** Cards per unit, used when the density is "custom". */
  densityRatio?: number | null;
  /** How much of each card to ask for. Lean by default; see `schemas.ts`. */
  detail?: GenerationDetail;
  /** Requests in flight at once. */
  concurrency?: number;
  /**
   * Study-guide runs: show each batch only its likely objectives. On by
   * default; off sends every objective to every batch, as before.
   */
  routeObjectives?: boolean;
  onProgress?: (progress: GenerationProgress) => void;
};

/**
 * How alike two questions may be before a high-density run treats the second
 * as a repeat. Stricter than the default because thirty cards a page is where
 * rewordings creep in.
 */
const HIGH_DENSITY_SIMILARITY = 0.75;

export async function generateCardsForExam(
  db: Db,
  llm: LlmProvider,
  examId: string,
  options: GenerateOptions = {},
): Promise<GenerationSummary> {
  const exam = db.select().from(exams).where(eq(exams.id, examId)).get();
  if (!exam) throw new Error(`Exam ${examId} not found`);

  const slides = loadSlides(db, examId, options.sourceFileIds, options.ranges);
  if (slides.length === 0) {
    throw new Error(
      options.ranges && Object.keys(options.ranges).length > 0
        ? "The slide range you chose contains no readable slides. Widen it, or check the page numbers against the file."
        : "No extracted slides for this exam. Upload and ingest sources first.",
    );
  }

  // The exam remembers its density, so a run started from anywhere behaves
  // the way the deck was last set up to behave.
  const density = options.density ?? exam.extractionDensity;
  const densityRatio = options.densityRatio ?? exam.extractionRatio;
  const highDensity = isHighDensity(density, densityRatio);
  const detail: GenerationDetail = options.detail ?? "lean";
  const system = generationSystem(
    density,
    densityRatio,
    detail,
    calibrationFor(llm.model).overshoot,
  );

  const objectives =
    exam.scopeMode === "objectives" ? loadObjectives(db, examId) : [];

  // Study-guide focus needs objectives to anchor to; without them the mode
  // would silently behave like full coverage, which is not what was asked for.
  if (exam.scopeMode === "objectives" && objectives.length === 0) {
    throw new Error(
      "This exam is set to study-guide focus but has no objectives. Upload a study guide, or switch the exam to full coverage.",
    );
  }

  const baseBatchSize =
    options.batchSize ?? calibrationFor(llm.model).batchSize ?? DEFAULT_BATCH_SIZE;
  // An admin asking for thirty a page needs a reply that can hold them.
  const batchSize = highDensity
    ? batchSizeFor(ratioFor(density, densityRatio, ADMIN_MAX_RATIO), baseBatchSize)
    : baseBatchSize;
  const allBatches = batchSlides(slides, batchSize);

  // Study-guide runs show each batch only the objectives its pages are likely
  // to answer, and skip a batch that answers none (see `routing.ts`).
  const routing =
    objectives.length > 0 && options.routeObjectives !== false
      ? routeObjectives(allBatches, objectives)
      : allBatches.map(() => objectives);
  const work = allBatches
    .map((batch, index) => ({ batch, objectives: routing[index] }))
    .filter((entry) => exam.scopeMode !== "objectives" || entry.objectives.length > 0);
  const batches = work.map((entry) => entry.batch);

  const fileNames = new Map(
    db
      .select({ id: sourceFiles.id, filename: sourceFiles.filename, fileType: sourceFiles.fileType })
      .from(sourceFiles)
      .where(eq(sourceFiles.examId, examId))
      .all()
      .map((file) => [file.id, file]),
  );
  const answered = new Set<string>();
  const rejectionViews: RejectionView[] = [];

  // Deduplicate against what is already stored, so re-running generation adds
  // to the deck instead of duplicating it.
  const existingRows = db
    .select({ question: flashcards.question, slideId: flashcards.sourceSlideId })
    .from(flashcards)
    .where(eq(flashcards.examId, examId))
    .all();
  const existingQuestions = new Set(existingRows.map((row) => row.question));

  // The same, by slide, for the prompt's "already covered" list: a re-run or
  // a high-density run is told what the deck has so it adds rather than
  // rephrases.
  const coveredBySlide = new Map<string, string[]>();
  for (const row of existingRows) {
    if (!row.slideId) continue;
    const list = coveredBySlide.get(row.slideId) ?? [];
    list.push(row.question);
    coveredBySlide.set(row.slideId, list);
  }

  const rejections: Rejection[] = [];
  const failedBatches: { batch: number; error: string }[] = [];
  let cardsCreated = 0;
  let completed = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  const startedAt = Date.now();
  // Never more slots than batches: a limiter wider than the work does nothing
  // except make the number in the log misleading.
  const limit = pLimit(
    Math.max(1, Math.min(batches.length, options.concurrency ?? DEFAULT_CONCURRENCY)),
  );
  const schema = generatedCardSchema(detail, {
    objectives: exam.scopeMode === "objectives",
  });

  // Report the size of the run before anything finishes, so the bar reads
  // "0 of 38" straight away instead of an indefinite "reading…".
  options.onProgress?.({
    batchIndex: 0,
    batchCount: batches.length,
    cardsCreated: 0,
    cardsRejected: 0,
    accepted: 0,
    rejected: 0,
  });

  await Promise.all(
    work.map(({ batch, objectives: batchObjectives }, batchIndex) =>
      limit(async () => {
        const promptOptions = {
          includeApplication: exam.includeApplication,
          covered: batch.flatMap((slide) => coveredBySlide.get(slide.id) ?? []),
        };
        const prompt =
          exam.scopeMode === "objectives"
            ? objectiveFocusPrompt(batch, batchObjectives, promptOptions)
            : fullCoveragePrompt(batch, promptOptions);

        try {
          const batchStarted = Date.now();
          const { data, usage } = await withRetry(() =>
            llm.generateStructured<GenerationResponse>({
              feature: "generate",
              system,
              prompt,
              schema,
              temperature: 0,
            }),
          );

          const result = validateCards(data.cards ?? [], batch, {
            existingQuestions,
            // Near-duplicates are the failure mode of asking for many cards.
            similarity: highDensity ? HIGH_DENSITY_SIMILARITY : undefined,
          });

          // Safe without a lock: JavaScript runs one of these at a time, and
          // nothing here awaits between reading the set and writing to it.
          for (const validated of result.accepted) {
            existingQuestions.add(validated.card.question);
          }
          rejections.push(...result.rejected);
          for (const rejection of result.rejected) {
            rejectionViews.push(describeRejection(rejection, batch, fileNames));
          }

          // Resolve each accepted card's tag back to a real objective. A tag
          // that names no objective in this batch is ignored, not guessed.
          batchObjectives.forEach((objective, index) => {
            const token = objectiveToken(index).toLowerCase();
            if (
              result.accepted.some(
                ({ card }) => card.objective?.trim().toLowerCase().replace(/[^a-z0-9]/g, "") === token,
              )
            ) {
              answered.add(objective.id);
            }
          });

          cardsCreated += persistCards(db, examId, result.accepted);

          const batchUsage = {
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
          };
          inputTokens += batchUsage.inputTokens;
          outputTokens += batchUsage.outputTokens;
          console.log(
            `[generate] batch ${batchIndex + 1}/${batches.length}: ${batch.length} units -> ${result.accepted.length} cards` +
              (result.rejected.length > 0 ? ` (${result.rejected.length} rejected)` : "") +
              `, ${batchUsage.inputTokens} in / ${batchUsage.outputTokens} out tokens, ` +
              `${formatCost(estimateCost(llm.model, batchUsage))} on ${llm.model}, ${Date.now() - batchStarted}ms`,
          );

          completed += 1;
          options.onProgress?.({
            batchIndex: completed,
            batchCount: batches.length,
            cardsCreated,
            cardsRejected: rejections.length,
            accepted: result.accepted.length,
            rejected: result.rejected.length,
          });
        } catch (error) {
          // One batch failing must not throw away the nineteen that worked.
          // The failure is reported; the cards already stored are kept.
          failedBatches.push({
            batch: batchIndex + 1,
            error: error instanceof Error ? error.message : String(error),
          });

          completed += 1;
          options.onProgress?.({
            batchIndex: completed,
            batchCount: batches.length,
            cardsCreated,
            cardsRejected: rejections.length,
            accepted: 0,
            rejected: 0,
          });
        }
      }),
    ),
  );

  // Every batch failing is not a partial result, it is a broken run — usually
  // a bad key or no network — and saying "0 cards created" would hide that.
  if (failedBatches.length === batches.length) {
    throw new Error(
      `Generation failed: ${failedBatches[0]?.error ?? "every batch failed"}`,
    );
  }

  const durationMs = Date.now() - startedAt;
  const estimatedCostUsd = estimateCost(llm.model, { inputTokens, outputTokens });
  console.log(
    `[generate] ${examId}: ${cardsCreated} cards from ${slides.length} units in ${batches.length} batch(es), ${durationMs}ms, ` +
      `${inputTokens} in / ${outputTokens} out tokens, ${formatCost(estimatedCostUsd)} on ${llm.model}` +
      (failedBatches.length > 0 ? ` (${failedBatches.length} batch(es) failed)` : ""),
  );

  return {
    mode: exam.scopeMode,
    density,
    detail,
    unitsUsed: slides.length,
    batchCount: batches.length,
    cardsCreated,
    cardsRejected: rejections.length,
    durationMs,
    failedBatches,
    model: llm.model,
    usage: { inputTokens, outputTokens, estimatedCostUsd },
    rejections,
    objectivesWithoutCards: objectives
      .filter((objective) => !answered.has(objective.id))
      .map((objective) => ({ label: objective.label, text: objective.promptText })),
    objectivesTotal: objectives.length,
    rejectionViews,
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
          // Null on a lean run: the explanation is written on demand, the
          // first time someone asks for it (POST /api/cards/[id]/explain).
          fullExplanation: card.fullExplanation || null,
          cardType: card.cardType,
          sourceSlideId: slide.id,
          sourceExcerpt: card.sourceExcerpt,
          hasAiSupplement: card.hasAiSupplement === true,
          professorEmphasis: card.professorEmphasis === true,
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
  ranges?: Record<string, UnitRange>,
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
    .filter((slide) => slide.legibilityFlag !== "empty")
    // Filtered, never renumbered: `index` is the page number printed on the
    // student's own file, and every citation resolves through it.
    .filter((slide) => withinRange(slide, ranges));
}

function withinRange(
  slide: SourceSlide,
  ranges?: Record<string, UnitRange>,
): boolean {
  const range = ranges?.[slide.sourceFileId];
  if (!range) return true;

  const from = Math.min(range.from, range.to);
  const to = Math.max(range.from, range.to);
  return slide.index >= from && slide.index <= to;
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
