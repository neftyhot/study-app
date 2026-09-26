/**
 * Study guides being written right now, so the page can show how far along.
 *
 * A guide for a long lecture is a dozen model calls; the student should see
 * them tick by rather than one spinner for two minutes. Kept in memory: a run
 * lives in this process, and a restart ends it anyway.
 */
import type { Db } from "@/db/client";
import type { LlmProvider } from "@/lib/llm";

import type { PrimerDepth } from "@/db/schema";

import { generatePrimer, type PrimerProgress } from "./index";

export type PrimerRun = PrimerProgress & {
  running: boolean;
  error: string | null;
  finishedAt: number | null;
};

const store = globalThis as typeof globalThis & { __primerRuns?: Map<string, PrimerRun> };
const runs = (store.__primerRuns ??= new Map());

const key = (examId: string, depth: PrimerDepth) => `${examId}:${depth}`;

export function primerRun(examId: string, depth: PrimerDepth): PrimerRun | null {
  return runs.get(key(examId, depth)) ?? null;
}

/** Starts writing in the background; false if one is already going. */
export function startPrimerRun(db: Db, llm: LlmProvider, examId: string, depth: PrimerDepth): boolean {
  if (primerRun(examId, depth)?.running) return false;
  const id = key(examId, depth);
  const run: PrimerRun = {
    stage: "explaining",
    done: 0,
    total: 1,
    running: true,
    error: null,
    finishedAt: null,
  };
  runs.set(id, run);

  generatePrimer(db, llm, examId, depth, {
    onProgress: (progress) => Object.assign(run, progress),
  })
    .catch((error: unknown) => {
      run.error = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      run.running = false;
      run.finishedAt = Date.now();
    });
  return true;
}
