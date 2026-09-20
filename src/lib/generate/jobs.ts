/**
 * Generation as a tracked job.
 *
 * Generation writes each batch to the database as it finishes, so cards appear
 * gradually over minutes. Run as a plain request, that looked like a bug: the
 * spinner stopped when the browser stopped waiting, then more cards turned up
 * afterwards. The work had never stopped — only the watching had.
 *
 * So the run gets a row. Progress is written to it as batches complete, the UI
 * polls it, and navigating away or reloading loses nothing: the spinner comes
 * back because the job is still there.
 */
import { and, desc, eq } from "drizzle-orm";

import type { Db } from "@/db/client";
import { generationJobs, type GenerationJob } from "@/db/schema";
import type { LlmProvider } from "@/lib/llm";

import { generateCardsForExam, type GenerateOptions } from "./index";

export type JobMode = "append" | "replace" | "separate";

export function activeJob(db: Db, examId: string): GenerationJob | undefined {
  return db
    .select()
    .from(generationJobs)
    .where(
      and(eq(generationJobs.examId, examId), eq(generationJobs.status, "running")),
    )
    .orderBy(desc(generationJobs.startedAt))
    .get();
}

/** The job to show: whatever is running, else the most recent result. */
export function latestJob(db: Db, examId: string): GenerationJob | undefined {
  return (
    activeJob(db, examId) ??
    db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.examId, examId))
      .orderBy(desc(generationJobs.startedAt))
      .get()
  );
}

function touch(db: Db, jobId: string, patch: Partial<GenerationJob>) {
  try {
    db.update(generationJobs)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(generationJobs.id, jobId))
      .run();
  } catch {
    // A lost progress update must not fail the generation behind it.
  }
}

export type StartOptions = GenerateOptions & {
  mode?: JobMode;
  targetExamId?: string;
};

/**
 * Starts a run and returns its job immediately.
 *
 * The generation itself is deliberately not awaited — the caller answers the
 * request, and the batches carry on writing to the job row.
 */
export function startGenerationJob(
  db: Db,
  llm: LlmProvider,
  examId: string,
  options: StartOptions = {},
): GenerationJob {
  const targetExamId = options.targetExamId ?? examId;

  const job = db
    .insert(generationJobs)
    .values({
      examId,
      targetExamId,
      mode: options.mode ?? "append",
      status: "running",
    })
    .returning()
    .get();

  void generateCardsForExam(db, llm, targetExamId, {
    ...options,
    onProgress(progress) {
      touch(db, job.id, {
        // Reported as batches finish, so "3 of 12" means three are safely
        // stored, not three have been attempted.
        batchIndex: progress.batchIndex + 1,
        batchCount: progress.batchCount,
        cardsCreated:
          (activeJob(db, examId)?.cardsCreated ?? 0) + progress.accepted,
        cardsRejected:
          (activeJob(db, examId)?.cardsRejected ?? 0) + progress.rejected,
      });
      options.onProgress?.(progress);
    },
  })
    .then((summary) => {
      touch(db, job.id, {
        status: "done",
        batchIndex: summary.batchCount,
        batchCount: summary.batchCount,
        cardsCreated: summary.cardsCreated,
        cardsRejected: summary.cardsRejected,
        finishedAt: new Date().toISOString(),
        summary: {
          mode: summary.mode,
          batchCount: summary.batchCount,
          cardsCreated: summary.cardsCreated,
          cardsRejected: summary.cardsRejected,
          uncoveredNotes: summary.uncoveredNotes,
          rejections: summary.rejections.map((rejection) => ({
            reason: rejection.reason,
            detail: rejection.detail,
            question: rejection.card.question,
          })),
        },
      });
    })
    .catch((error: unknown) => {
      touch(db, job.id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      });
    });

  return job;
}

/** Marks a stuck job finished, so the UI is not pinned on a spinner forever. */
export function abandonJob(db: Db, jobId: string) {
  touch(db, jobId, {
    status: "failed",
    error: "Stopped.",
    finishedAt: new Date().toISOString(),
  });
}
