"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import type { OcclusionMask } from "@/db/schema";
import { gradeCard } from "@/lib/study/session";

import { slideImage } from "./render";

import {
  createDrill,
  DrillError,
  updateDrill,
  type NewDrill,
} from "./index";
import { gradeForDrill, type MaskResult } from "./masks";

export type DrillActionResult =
  | { ok: true; drillId: string }
  | { ok: false; problems: string[] };

export type NewDrillInput = Omit<NewDrill, "imagePath"> & {
  /** Resolved from the slide when the caller does not already know it. */
  imagePath?: string;
};

export async function createDrillAction(
  input: NewDrillInput,
): Promise<DrillActionResult> {
  try {
    // The picture is whatever the slide renders to, and the client has no
    // business knowing where that lands on disk.
    const imagePath =
      input.imagePath ??
      (input.sourceSlideId
        ? (await slideImage(db, input.sourceSlideId)).path
        : null);

    if (!imagePath) {
      return { ok: false, problems: ["This drill has no picture to draw on."] };
    }

    const { drill } = createDrill(db, { ...input, imagePath });
    revalidatePath(`/exams/${input.examId}/diagrams`);
    revalidatePath(`/exams/${input.examId}/sources`);
    revalidatePath(`/exams/${input.examId}`);
    return { ok: true, drillId: drill.id };
  } catch (error) {
    if (error instanceof DrillError) return { ok: false, problems: error.problems };
    throw error;
  }
}

export async function updateDrillAction(
  examId: string,
  drillId: string,
  masks: OcclusionMask[],
): Promise<DrillActionResult> {
  try {
    const drill = updateDrill(db, drillId, masks);
    if (!drill) return { ok: false, problems: ["That drill no longer exists."] };
    revalidatePath(`/exams/${examId}/diagrams`);
    return { ok: true, drillId: drill.id };
  } catch (error) {
    if (error instanceof DrillError) return { ok: false, problems: error.problems };
    throw error;
  }
}

/**
 * One self-grade for the whole diagram, through the same scheduler every
 * other card uses. A drill that kept its own score would drift out of the
 * review schedule and stop being a card.
 */
export async function gradeDrillAction(
  examId: string,
  flashcardId: string,
  masks: OcclusionMask[],
  results: Record<string, MaskResult>,
) {
  const outcome = gradeForDrill(masks, results);
  gradeCard(db, flashcardId, outcome.grade);
  revalidatePath(`/exams/${examId}`);
  return outcome;
}
