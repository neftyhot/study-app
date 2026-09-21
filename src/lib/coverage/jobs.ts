/**
 * A coverage check running in the background, with progress.
 *
 * The check used to be one request held open for minutes behind a spinner.
 * Now the request starts it and returns; the passes report as each call
 * finishes, and the panel polls, the same way generation works.
 *
 * Held in memory rather than in a table: coverage rows are derived data that
 * every run rewrites, and a run lost to a restart is simply run again. It lives
 * on `globalThis` so a dev-server reload does not orphan a running check.
 */
import type { Db } from "@/db/client";
import type { LlmProvider } from "@/lib/llm";

import {
  analyzeCoverageForExam,
  type CoverageOptions,
  type CoverageProgress,
  type CoverageSummary,
} from "./index";

export type CoveragePhase = CoverageProgress["phase"];

export type CoverageJob = {
  examId: string;
  status: "running" | "done" | "failed";
  /** Per phase: calls finished of calls planned. A phase appears once it starts. */
  phases: Partial<Record<CoveragePhase, { done: number; total: number }>>;
  checkConflicts: boolean;
  startedAt: number;
  finishedAt: number | null;
  summary: CoverageSummary | null;
  error: string | null;
};

const store = globalThis as typeof globalThis & {
  __coverageJobs?: Map<string, CoverageJob>;
};
const jobs = (store.__coverageJobs ??= new Map());

export function coverageJob(examId: string): CoverageJob | null {
  return jobs.get(examId) ?? null;
}

export function startCoverageJob(
  db: Db,
  llm: LlmProvider,
  examId: string,
  options: CoverageOptions = {},
): CoverageJob {
  const job: CoverageJob = {
    examId,
    status: "running",
    phases: {},
    checkConflicts: !options.skipConflicts,
    startedAt: Date.now(),
    finishedAt: null,
    summary: null,
    error: null,
  };
  jobs.set(examId, job);

  void analyzeCoverageForExam(db, llm, examId, {
    ...options,
    onProgress(progress) {
      job.phases[progress.phase] = {
        done: progress.batchIndex,
        total: progress.batchCount,
      };
    },
  })
    .then((summary) => {
      job.status = "done";
      job.summary = summary;
    })
    .catch((error: unknown) => {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      job.finishedAt = Date.now();
    });

  return job;
}

/**
 * One number for the bar, from phases of different lengths.
 *
 * Matching is most of the work and the gap review can only be sized once
 * matching ends, so each phase owns a fixed share rather than the bar
 * jumping backwards when the review's size becomes known.
 */
export function coveragePercent(job: Pick<CoverageJob, "phases" | "checkConflicts" | "status">): number {
  if (job.status === "done") return 100;
  const share = job.checkConflicts
    ? { mapping: 55, review: 25, conflicts: 20 }
    : { mapping: 70, review: 30, conflicts: 0 };

  let percent = 0;
  for (const phase of ["mapping", "review", "conflicts"] as const) {
    const state = job.phases[phase];
    if (state && state.total > 0) percent += (share[phase] * state.done) / state.total;
  }
  return Math.min(99, Math.max(3, Math.round(percent)));
}
