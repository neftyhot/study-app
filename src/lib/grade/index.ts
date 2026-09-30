import { existsSync } from "node:fs";
import { totalmem } from "node:os";

import { createKeywordGrader, type TypedAnswerGrader } from "@/lib/learn/typed";
import { getProvider } from "@/lib/llm";
import { GRADER_MIN_RAM_GB } from "@/lib/llm/catalog";
import {
  readGraderDownload,
  readGradingMode,
  readGradingStrictness,
} from "@/lib/settings";

import { createLocalGrader, prewarmLocalGrader } from "./local";
import { createSemanticGrader } from "./semantic";
import type { Strictness } from "./strictness";

export * from "./schemas";
export { createSemanticGrader, reconcileGrade } from "./semantic";
export { gradeFromMarks, unloadLocalGrader } from "./local";
export { GRADING_SYSTEM, gradingPrompt, tokenizePoints } from "./prompts";
export * from "./strictness";

/** How long the API gets when the local model can take over, and when it can't. */
const API_TIMEOUT_WITH_BACKUP_MS = 4_000;
const API_TIMEOUT_ALONE_MS = 15_000;
/** Generous: covers loading the model from disk on the first grade of a session. */
const LOCAL_TIMEOUT_MS = 30_000;

/** Whether this computer has the memory to run the grading model alongside the app. */
export function canGradeLocally(): boolean {
  // An "8 GB" Mac reports exactly 8 GiB; allow a little under for rounding.
  return totalmem() >= GRADER_MIN_RAM_GB * 1_073_741_824 * 0.95;
}

/** The downloaded grading model, if it is ready and this computer can run it. */
export function localGraderPath(): string | null {
  const download = readGraderDownload();
  if (download?.status !== "ready" || !download.path) return null;
  if (!existsSync(download.path) || !canGradeLocally()) return null;
  return download.path;
}

/**
 * Loads the grading model and caches its prompt before the student's first
 * answer, so the first Check Answer is as fast as the rest. Does nothing when
 * grading goes to the API.
 */
export async function prewarmGrader(): Promise<void> {
  if (readGradingMode() !== "local") return;
  const path = localGraderPath();
  if (path) await prewarmLocalGrader(path);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * The grader the app uses.
 *
 * Check Answer runs on this computer when the grading model is installed and
 * the student hasn't chosen the cloud: about half a second, no quota, no
 * network. The API is the backup, and when the API is first it gets only a few
 * seconds before the local model answers instead. Only when neither is
 * available does the keyword stand-in grade — and it marks its grades
 * `provisional` so the UI can say the answer was matched on keywords, not
 * understood.
 *
 * Decided per call, so a change in Settings applies to the next answer.
 */
export function getTypedGrader(strictness?: Strictness | null): TypedAnswerGrader {
  const level = strictness ?? readGradingStrictness();
  const localPath = localGraderPath();

  const local = localPath
    ? createLocalGrader({ modelPath: localPath, strictness: level })
    : null;

  let api: TypedAnswerGrader | null = null;
  try {
    api = createSemanticGrader(getProvider(undefined, "grade"), {
      strictness: level,
      // 12/12 grading fixtures with thinking off as with it on, at a quarter
      // of the cost and a fraction of the wait (`npm run grade:check`).
      thinking: "minimal",
    });
  } catch {
    api = null;
  }

  const keyword = createKeywordGrader();

  const timed = (grader: TypedAnswerGrader | null, ms: number) =>
    grader && {
      name: grader.name,
      grade: (request: Parameters<TypedAnswerGrader["grade"]>[0]) =>
        withTimeout(grader.grade(request), ms),
    };

  const order = (
    readGradingMode() === "local" && local
      ? [timed(local, LOCAL_TIMEOUT_MS), timed(api, API_TIMEOUT_ALONE_MS)]
      : [
          timed(api, local ? API_TIMEOUT_WITH_BACKUP_MS : API_TIMEOUT_ALONE_MS),
          timed(local, LOCAL_TIMEOUT_MS),
        ]
  ).filter((grader): grader is TypedAnswerGrader => Boolean(grader));

  if (order.length === 0) return keyword;

  return {
    name: order[0].name,
    async grade(request) {
      for (const grader of order) {
        try {
          return await grader.grade(request);
        } catch {
          // Next in line.
        }
      }
      return keyword.grade(request);
    },
  };
}
