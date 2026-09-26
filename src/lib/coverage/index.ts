/**
 * Coverage analysis: objectives × cards × source material (PRD §3, MVP #3).
 *
 * Three passes, each answering a different question the student actually has:
 *  1. Mapping — which cards answer each objective, and is that enough?
 *  2. Review  — for the objectives that came back short, does the uploaded
 *     material even answer them? "We failed to make the card" and "your files
 *     never cover this" call for completely different responses.
 *  3. Conflicts — do two files contradict each other?
 *
 * Like ingestion and generation, this is a plain function over a `Db` and an
 * `LlmProvider`, so it runs from a route, a script, or a queue and is testable
 * with a stubbed provider.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import pLimit from "p-limit";

import type { Db } from "@/db/client";
import {
  contentConflicts,
  coverageMappings,
  exams,
  flashcards,
  objectiveCoverage,
  sourceFiles,
  sourceSlides,
  type Flashcard,
  type StudyGuideObjective,
} from "@/db/schema";
import type { LlmProvider, StructuredRequest } from "@/lib/llm";
import { estimateCost, formatCost } from "@/lib/llm/pricing";
import { withRetry } from "@/lib/generate/retry";

import { buildIdf, rank } from "./candidates";
import { scanForConflicts, type ConflictOptions } from "./conflicts";
import {
  MAPPING_SYSTEM,
  mappingPrompt,
  REVIEW_SYSTEM,
  reviewPrompt,
  tokenize,
  type LabeledSlide,
} from "./prompts";
import {
  COVERAGE_MAPPING_SCHEMA,
  COVERAGE_REVIEW_SCHEMA,
  type CoverageMappingResponse,
  type CoverageReviewResponse,
} from "./schemas";
import {
  validateMapping,
  validateReview,
  type ResolvedMapping,
  type ResolvedReview,
} from "./validate";
import { fileUploadOrder, loadObjectives } from "@/lib/order";

export type CoverageProgress = {
  phase: "mapping" | "review" | "conflicts";
  /** Calls finished in this phase — counted as they finish, not as they start. */
  batchIndex: number;
  batchCount: number;
};

/**
 * Requests in flight at once, per pass.
 *
 * Every call in a pass is independent — one objective group's verdict never
 * depends on another's — so they ran one after another only because they were
 * written that way. Measured on a 48-objective guide: 5 min 36 s sequential.
 */
export const COVERAGE_CONCURRENCY = 12;

/** Adds up what a run spent, across passes that run at the same time. */
export class UsageMeter {
  inputTokens = 0;
  outputTokens = 0;
  calls = 0;

  constructor(
    private readonly llm: LlmProvider,
    private readonly thinking?: StructuredRequest["thinking"],
  ) {}

  /** A structured call, retried on rate limits, with its tokens counted. */
  async call<T>(request: StructuredRequest): Promise<T> {
    const { data, usage } = await withRetry(() =>
      this.llm.generateStructured<T>({
        feature: "coverage",
        thinking: this.thinking,
        ...request,
      }),
    );
    this.calls += 1;
    this.inputTokens += usage?.inputTokens ?? 0;
    this.outputTokens += usage?.outputTokens ?? 0;
    return data;
  }

  get cost(): number | null {
    return estimateCost(this.llm.model, this);
  }
}

export type CoverageSummary = {
  objectives: number;
  covered: number;
  partiallyCovered: number;
  missing: number;
  /** Gaps the uploaded material could fill — generation missed them. */
  fixableGaps: number;
  /** Gaps the uploaded material cannot fill — the files never cover it. */
  sourceGaps: number;
  cardsMapped: number;
  /** Card or objective references the model invented. */
  unresolvedReferences: number;
  /** Supporting quotes that were not actually in the slide cited. */
  unverifiedCitations: number;
  conflicts: number;
  conflictPairsChecked: number;
  durationMs?: number;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number; estimatedCostUsd: number | null };
};

export type CoverageOptions = {
  objectivesPerCall?: number;
  cardsPerObjective?: number;
  maxCandidateCards?: number;
  reviewObjectivesPerCall?: number;
  slidesPerObjective?: number;
  /** Conflict detection is the most expensive pass and the least often needed. */
  skipConflicts?: boolean;
  concurrency?: number;
  thinking?: StructuredRequest["thinking"];
  conflicts?: ConflictOptions;
  onProgress?: (progress: CoverageProgress) => void;
};

export async function analyzeCoverageForExam(
  db: Db,
  llm: LlmProvider,
  examId: string,
  options: CoverageOptions = {},
): Promise<CoverageSummary> {
  const exam = db.select().from(exams).where(eq(exams.id, examId)).get();
  if (!exam) throw new Error(`Exam ${examId} not found`);

  const objectives = loadObjectives(db, examId);
  if (objectives.length === 0) {
    throw new Error(
      "This exam has no study-guide objectives. Upload a study guide to build a coverage matrix.",
    );
  }

  const cards = db
    .select()
    .from(flashcards)
    .where(and(eq(flashcards.examId, examId), eq(flashcards.excluded, false)))
    .all();

  const slides = loadAnswerSlides(db, examId);
  const meter = new UsageMeter(llm, options.thinking);
  const startedAt = Date.now();

  // Contradictions between files depend only on the files, not on the cards,
  // so that scan runs alongside the mapping instead of after everything else.
  const scanning = options.skipConflicts
    ? Promise.resolve({ conflicts: [], pairsChecked: 0, unverified: 0 })
    : scanForConflicts(meter, slides, {
        ...options.conflicts,
        concurrency: options.concurrency ?? COVERAGE_CONCURRENCY,
        onProgress: (done, total) =>
          options.onProgress?.({ phase: "conflicts", batchIndex: done, batchCount: total }),
      });

  // Marked handled now; a failure still surfaces at the `await` below.
  scanning.catch(() => undefined);

  const mapping = await runMappingPass(meter, objectives, cards, options);
  const gaps = mapping.mappings.filter((m) => m.status !== "covered");
  const review = await runReviewPass(meter, gaps, slides, options);
  const scan = await scanning;

  persist(
    db,
    examId,
    objectives,
    mapping.mappings,
    review.reviews,
    scan.conflicts,
    cards.length,
  );

  const reviewByObjective = new Map(
    review.reviews.map((r) => [r.objective.id, r]),
  );

  let covered = 0;
  let partiallyCovered = 0;
  let missing = 0;
  let fixableGaps = 0;
  let sourceGaps = 0;
  let cardsMapped = 0;

  for (const entry of mapping.mappings) {
    if (entry.status === "covered") covered += 1;
    else if (entry.status === "partially_covered") partiallyCovered += 1;
    else missing += 1;

    cardsMapped += entry.cards.length;

    if (entry.status !== "covered") {
      const support = reviewByObjective.get(entry.objective.id)?.sourceSupport;
      if (support === "silent") sourceGaps += 1;
      else if (support) fixableGaps += 1;
    }
  }

  const durationMs = Date.now() - startedAt;
  console.log(
    `[coverage] ${examId}: ${objectives.length} objectives, ${meter.calls} calls in ${durationMs}ms, ` +
      `${meter.inputTokens} in / ${meter.outputTokens} out tokens, ${formatCost(meter.cost)} on ${llm.model}`,
  );

  return {
    durationMs,
    model: llm.model,
    usage: {
      inputTokens: meter.inputTokens,
      outputTokens: meter.outputTokens,
      estimatedCostUsd: meter.cost,
    },
    objectives: objectives.length,
    covered,
    partiallyCovered,
    missing,
    fixableGaps,
    sourceGaps,
    cardsMapped,
    unresolvedReferences: mapping.unresolvedReferences,
    unverifiedCitations: review.unverifiedCitations + scan.unverified,
    conflicts: scan.conflicts.length,
    conflictPairsChecked: scan.pairsChecked,
  };
}

/* ------------------------------------------------------------------ Passes */

async function runMappingPass(
  meter: UsageMeter,
  objectives: StudyGuideObjective[],
  cards: Flashcard[],
  options: CoverageOptions,
) {
  const perCall = options.objectivesPerCall ?? 4;
  const perObjective = options.cardsPerObjective ?? 18;
  const maxCards = options.maxCandidateCards ?? 48;

  const idf = buildIdf(cards.map(cardText));
  const batches = chunk(objectives, perCall);
  const limit = pLimit(options.concurrency ?? COVERAGE_CONCURRENCY);

  let done = 0;
  options.onProgress?.({ phase: "mapping", batchIndex: 0, batchCount: batches.length });

  const results = await Promise.all(
    batches.map((batch) =>
      limit(async () => {
        // Candidates are the union of each objective's best matches, so one
        // objective with many strong matches cannot crowd the others out.
        const candidates = new Map<string, Flashcard>();
        for (const objective of batch) {
          for (const card of rank(
            objective.promptText,
            cards,
            cardText,
            idf,
            { limit: perObjective, minScore: 0 },
          )) {
            candidates.set(card.id, card);
          }
        }

        const tokenizedObjectives = tokenize("O", batch);
        const tokenizedCards = tokenize(
          "C",
          [...candidates.values()].slice(0, maxCards),
        );

        const data = await meter.call<CoverageMappingResponse>({
          system: MAPPING_SYSTEM,
          prompt: mappingPrompt(tokenizedObjectives, tokenizedCards),
          schema: COVERAGE_MAPPING_SCHEMA,
          temperature: 0,
        });

        const result = validateMapping(data, tokenizedObjectives, tokenizedCards);
        done += 1;
        options.onProgress?.({ phase: "mapping", batchIndex: done, batchCount: batches.length });
        return result;
      }),
    ),
  );

  // Kept in guide order whatever order the calls finished in.
  return {
    mappings: results.flatMap((result) => result.mappings),
    unresolvedReferences: results.reduce((sum, r) => sum + r.unresolvedReferences, 0),
  };
}

async function runReviewPass(
  meter: UsageMeter,
  gaps: ResolvedMapping[],
  slides: LabeledSlide[],
  options: CoverageOptions,
) {
  if (gaps.length === 0 || slides.length === 0) {
    return { reviews: [] as ResolvedReview[], unverifiedCitations: 0 };
  }

  const perCall = options.reviewObjectivesPerCall ?? 3;
  const perObjective = options.slidesPerObjective ?? 8;

  const idf = buildIdf(slides.map(slideSearchText));
  const batches = chunk(gaps, perCall);
  const limit = pLimit(options.concurrency ?? COVERAGE_CONCURRENCY);

  let done = 0;
  options.onProgress?.({ phase: "review", batchIndex: 0, batchCount: batches.length });

  const results = await Promise.all(
    batches.map((batch) =>
      limit(async () => {
        const candidates = new Map<string, LabeledSlide>();
        for (const gap of batch) {
          for (const labeled of rank(
            gap.objective.promptText,
            slides,
            slideSearchText,
            idf,
            { limit: perObjective, minScore: 0 },
          )) {
            candidates.set(labeled.slide.id, labeled);
          }
        }

        const tokenizedObjectives = tokenize(
          "O",
          batch.map((gap) => gap.objective),
        );
        const tokenizedSlides = tokenize("S", [...candidates.values()]);

        const data = await meter.call<CoverageReviewResponse>({
          system: REVIEW_SYSTEM,
          prompt: reviewPrompt(tokenizedObjectives, tokenizedSlides),
          schema: COVERAGE_REVIEW_SCHEMA,
          temperature: 0,
        });

        const result = validateReview(data, tokenizedObjectives, tokenizedSlides);
        done += 1;
        options.onProgress?.({ phase: "review", batchIndex: done, batchCount: batches.length });
        return result;
      }),
    ),
  );

  return {
    reviews: results.flatMap((result) => result.reviews),
    unverifiedCitations: results.reduce((sum, r) => sum + r.unverifiedCitations, 0),
  };
}

/* ------------------------------------------------------------- Persistence */

/**
 * Coverage rows are derived data: they are recomputed wholesale, unlike cards
 * and progress, which are never wiped (ARCHITECTURE principle #3). Conflicts
 * are the exception — once the student resolves or dismisses one, that
 * judgement is theirs and survives every later scan.
 */
function persist(
  db: Db,
  examId: string,
  objectives: StudyGuideObjective[],
  mappings: ResolvedMapping[],
  reviews: ResolvedReview[],
  conflicts: Awaited<ReturnType<typeof scanForConflicts>>["conflicts"],
  cardCount: number,
) {
  const objectiveIds = objectives.map((o) => o.id);
  const reviewByObjective = new Map(reviews.map((r) => [r.objective.id, r]));

  db.transaction((tx) => {
    tx.delete(coverageMappings)
      .where(inArray(coverageMappings.objectiveId, objectiveIds))
      .run();
    tx.delete(objectiveCoverage)
      .where(inArray(objectiveCoverage.objectiveId, objectiveIds))
      .run();

    for (const entry of mappings) {
      for (const mapped of entry.cards) {
        tx.insert(coverageMappings)
          .values({
            objectiveId: entry.objective.id,
            flashcardId: mapped.card.id,
            status: mapped.status,
          })
          .run();
      }

      const review = reviewByObjective.get(entry.objective.id);

      tx.insert(objectiveCoverage)
        .values({
          objectiveId: entry.objective.id,
          cardsConsidered: cardCount,
          status: entry.status,
          rationale: entry.rationale || null,
          missingPoints: mergePoints(
            entry.missingPoints,
            review?.missingPoints ?? [],
          ),
          sourceSupport: review?.sourceSupport ?? null,
          supportingSlideId: review?.slide?.id ?? null,
          supportingExcerpt: review?.excerpt ?? null,
        })
        .run();
    }

    // Keep anything the student has acted on; replace the rest.
    const kept = tx
      .select()
      .from(contentConflicts)
      .where(eq(contentConflicts.examId, examId))
      .all()
      .filter((row) => row.dismissed || row.resolution);

    tx.delete(contentConflicts)
      .where(eq(contentConflicts.examId, examId))
      .run();

    for (const row of kept) {
      tx.insert(contentConflicts).values(row).run();
    }

    const keptPairs = new Set(
      kept.map((row) => [row.slideAId, row.slideBId].sort().join("|")),
    );

    for (const conflict of conflicts) {
      const key = [conflict.slideA.id, conflict.slideB.id].sort().join("|");
      if (keptPairs.has(key)) continue;

      tx.insert(contentConflicts)
        .values({
          examId,
          topic: conflict.topic || null,
          statementA: conflict.statementA,
          slideAId: conflict.slideA.id,
          statementB: conflict.statementB,
          slideBId: conflict.slideB.id,
          explanation: conflict.explanation,
        })
        .run();
    }
  });
}

function mergePoints(...lists: string[][]): string[] {
  const seen = new Map<string, string>();
  for (const point of lists.flat()) {
    const key = point.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, point.trim());
  }
  return [...seen.values()];
}

/* ------------------------------------------------------------------ Loading */

/** Every unit that can answer an objective, tagged with the file it came from. */
function loadAnswerSlides(db: Db, examId: string): LabeledSlide[] {
  return db
    .select({ slide: sourceSlides, fileName: sourceFiles.filename })
    .from(sourceSlides)
    .innerJoin(sourceFiles, eq(sourceSlides.sourceFileId, sourceFiles.id))
    .where(
      and(
        eq(sourceFiles.examId, examId),
        eq(sourceFiles.status, "ready"),
        ne(sourceFiles.role, "study_guide"),
      ),
    )
    .orderBy(...fileUploadOrder(sourceSlides.sourceFileId), sourceSlides.index)
    .all()
    .filter(({ slide }) => slide.legibilityFlag !== "empty");
}

function cardText(card: Flashcard): string {
  return [
    card.topic ?? "",
    card.question,
    card.directAnswer,
    card.fullExplanation ?? "",
  ].join(" ");
}

function slideSearchText({ slide }: LabeledSlide): string {
  return [
    slide.title ?? "",
    slide.rawText,
    slide.speakerNotes ?? "",
    slide.tables.flatMap((t) => t.rows.flat()).join(" "),
  ].join(" ");
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

export { pairSlidesAcrossFiles, scanForConflicts } from "./conflicts";
export * from "./schemas";
