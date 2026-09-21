"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { contentConflicts, exams } from "@/db/schema";

/** Toggles an exam between full coverage and study-guide focus (PRD §1). */
export async function setScopeMode(examId: string, mode: "files" | "objectives") {
  db.update(exams)
    .set({ scopeMode: mode })
    .where(eq(exams.id, examId))
    .run();

  revalidatePath(`/exams/${examId}`);
}

/**
 * The exam date and the time available each day (PRD §12).
 *
 * Both are the student's own estimate, and both are allowed to be empty — the
 * planner simply says less when it knows less, rather than inventing a
 * deadline.
 */
export async function setExamSchedule(
  examId: string,
  date: string | null,
  dailyMinutes: number | null,
) {
  const minutes =
    dailyMinutes === null || !Number.isFinite(dailyMinutes)
      ? null
      : Math.min(Math.max(Math.round(dailyMinutes), 5), 600);

  db.update(exams)
    .set({ date: date?.trim() || null, dailyMinutes: minutes })
    .where(eq(exams.id, examId))
    .run();

  revalidatePath(`/exams/${examId}`);
  revalidatePath(`/exams/${examId}/plan`);
}

/**
 * Higher-order application questions on or off (PRD §9).
 *
 * Stored on the exam so it applies to every later generation run, rather than
 * being a per-click setting that is easy to forget having changed.
 */
export async function setIncludeApplication(
  examId: string,
  include: boolean,
) {
  db.update(exams)
    .set({ includeApplication: include })
    .where(eq(exams.id, examId))
    .run();

  revalidatePath(`/exams/${examId}`);
}

/**
 * Records the student's decision on a flagged conflict (PRD §3).
 *
 * The pipeline never resolves a conflict itself, and a later scan preserves
 * whatever the student decided here — that is the whole point of surfacing
 * both sides instead of silently picking one.
 */
export async function resolveConflict(conflictId: string, resolution: string) {
  const conflict = db
    .select()
    .from(contentConflicts)
    .where(eq(contentConflicts.id, conflictId))
    .get();
  if (!conflict) return;

  db.update(contentConflicts)
    .set({ resolution: resolution.trim() || null })
    .where(eq(contentConflicts.id, conflictId))
    .run();

  revalidatePath(`/exams/${conflict.examId}/coverage`);
}

export async function dismissConflict(conflictId: string, dismissed = true) {
  const conflict = db
    .select()
    .from(contentConflicts)
    .where(eq(contentConflicts.id, conflictId))
    .get();
  if (!conflict) return;

  db.update(contentConflicts)
    .set({ dismissed })
    .where(eq(contentConflicts.id, conflictId))
    .run();

  revalidatePath(`/exams/${conflict.examId}/coverage`);
}
