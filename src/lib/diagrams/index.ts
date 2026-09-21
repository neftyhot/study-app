/**
 * Diagram drills (PRD §10).
 *
 * A drill is a flashcard — not a parallel kind of object. It has provenance,
 * a rubric, review history and a place in the schedule like every other card,
 * and the occlusion row only adds the picture and the boxes over it. That is
 * what keeps a diagram from becoming a second study system bolted to the side
 * of the first.
 */
import { and, desc, eq } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  cardRubrics,
  diagramOcclusions,
  flashcards,
  sourceSlides,
  type OcclusionMask,
} from "@/db/schema";

import { labelSummary, readingOrder, validateMasks } from "./masks";

export * from "./masks";

export type NewDrill = {
  examId: string;
  sourceSlideId: string | null;
  /** Relative to the uploads root, as every stored path is. */
  imagePath: string;
  masks: OcclusionMask[];
  topic?: string | null;
  question?: string | null;
};

export class DrillError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(" "));
    this.name = "DrillError";
  }
}

function defaultQuestion(masks: OcclusionMask[]): string {
  return masks.length === 1
    ? "What is the hidden label on this diagram?"
    : `Name the ${masks.length} hidden labels on this diagram.`;
}

export function createDrill(db: Db, input: NewDrill) {
  const masks = readingOrder(input.masks);
  const problems = validateMasks(masks);
  if (problems.length > 0) throw new DrillError(problems);

  return db.transaction((tx) => {
    const card = tx
      .insert(flashcards)
      .values({
        examId: input.examId,
        topic: input.topic?.trim() || "Diagram",
        question: input.question?.trim() || defaultQuestion(masks),
        directAnswer: labelSummary(masks),
        cardType: "atomic",
        sourceSlideId: input.sourceSlideId,
        // A picture is not a quotation. The provenance link is the slide
        // itself, and leaving the excerpt empty says so rather than inventing
        // a sentence the slide never contained.
        sourceExcerpt: null,
        hasAiSupplement: false,
        // The student drew these boxes, so regenerating the deck must not
        // delete them.
        isUserEdited: true,
      })
      .returning()
      .get();

    tx.insert(cardRubrics)
      .values({
        flashcardId: card.id,
        essentialPoints: masks.map((mask) => mask.label.trim()),
        optionalPoints: [],
        commonMisconceptions: [],
      })
      .run();

    const drill = tx
      .insert(diagramOcclusions)
      .values({
        flashcardId: card.id,
        sourceSlideId: input.sourceSlideId,
        imagePath: input.imagePath,
        maskCoordinates: masks,
      })
      .returning()
      .get();

    return { card, drill };
  });
}

export function updateDrill(
  db: Db,
  drillId: string,
  masks: OcclusionMask[],
  patch: { topic?: string | null; question?: string | null } = {},
) {
  const ordered = readingOrder(masks);
  const problems = validateMasks(ordered);
  if (problems.length > 0) throw new DrillError(problems);

  const existing = db
    .select()
    .from(diagramOcclusions)
    .where(eq(diagramOcclusions.id, drillId))
    .get();
  if (!existing) return undefined;

  const now = new Date().toISOString();

  return db.transaction((tx) => {
    tx.update(diagramOcclusions)
      .set({ maskCoordinates: ordered, updatedAt: now })
      .where(eq(diagramOcclusions.id, drillId))
      .run();

    tx.update(flashcards)
      .set({
        directAnswer: labelSummary(ordered),
        ...(patch.topic !== undefined ? { topic: patch.topic } : {}),
        ...(patch.question !== undefined && patch.question
          ? { question: patch.question }
          : {}),
        isUserEdited: true,
        updatedAt: now,
      })
      .where(eq(flashcards.id, existing.flashcardId))
      .run();

    tx.update(cardRubrics)
      .set({ essentialPoints: ordered.map((mask) => mask.label.trim()) })
      .where(eq(cardRubrics.flashcardId, existing.flashcardId))
      .run();

    return tx
      .select()
      .from(diagramOcclusions)
      .where(eq(diagramOcclusions.id, drillId))
      .get();
  });
}

/** Deleting the card deletes the drill, since the drill is the card. */
export function deleteDrill(db: Db, drillId: string): boolean {
  const drill = db
    .select()
    .from(diagramOcclusions)
    .where(eq(diagramOcclusions.id, drillId))
    .get();
  if (!drill) return false;

  db.delete(flashcards).where(eq(flashcards.id, drill.flashcardId)).run();
  return true;
}

export type DrillView = {
  id: string;
  flashcardId: string;
  imagePath: string;
  masks: OcclusionMask[];
  topic: string;
  question: string;
  sourceLabel: string | null;
};

export function listDrills(db: Db, examId: string): DrillView[] {
  return db
    .select({
      drill: diagramOcclusions,
      card: flashcards,
      slide: sourceSlides,
    })
    .from(diagramOcclusions)
    .innerJoin(flashcards, eq(diagramOcclusions.flashcardId, flashcards.id))
    .leftJoin(sourceSlides, eq(diagramOcclusions.sourceSlideId, sourceSlides.id))
    .where(and(eq(flashcards.examId, examId), eq(flashcards.excluded, false)))
    .orderBy(desc(diagramOcclusions.createdAt))
    .all()
    .map(({ drill, card, slide }) => ({
      id: drill.id,
      flashcardId: card.id,
      imagePath: drill.imagePath,
      masks: drill.maskCoordinates,
      topic: card.topic ?? "Diagram",
      question: card.question,
      sourceLabel: slide ? `Page ${slide.index}` : null,
    }));
}

/** How many drills each page already has, for the source viewer. */
export function drillCountsBySlide(
  db: Db,
  examId: string,
): Record<string, number> {
  const rows = db
    .select({ slideId: diagramOcclusions.sourceSlideId })
    .from(diagramOcclusions)
    .innerJoin(flashcards, eq(diagramOcclusions.flashcardId, flashcards.id))
    .where(eq(flashcards.examId, examId))
    .all();

  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!row.slideId) continue;
    counts[row.slideId] = (counts[row.slideId] ?? 0) + 1;
  }
  return counts;
}

/** The drills already built from one slide, so the viewer can say so. */
export function drillsForSlide(db: Db, slideId: string) {
  return db
    .select()
    .from(diagramOcclusions)
    .where(eq(diagramOcclusions.sourceSlideId, slideId))
    .all();
}
