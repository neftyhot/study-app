/**
 * Diagram occlusion geometry.
 *
 * Masks are stored as percentages of the image rather than pixels, so a drill
 * drawn on a laptop still lines up on a phone and survives the page being
 * re-rendered at a different scale. Everything here is pure arithmetic over
 * those percentages — the editor and the study runner share it, which is why
 * a box cannot mean one thing while being drawn and another while being
 * answered.
 */
import type { OcclusionMask } from "@/db/schema";

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

/**
 * The smallest box worth keeping, as a percentage of each axis.
 *
 * A click is a drag of zero size, and a twitch is a drag of almost none.
 * Neither is a mask, and silently creating one leaves an invisible target the
 * student can never click.
 */
export const MIN_MASK_SIZE = 1.5;

export function clampRect(rect: Rect): Rect {
  const x = Math.min(100, Math.max(0, rect.x));
  const y = Math.min(100, Math.max(0, rect.y));

  return {
    x,
    y,
    width: Math.min(100 - x, Math.max(0, rect.width)),
    height: Math.min(100 - y, Math.max(0, rect.height)),
  };
}

/** A drag in any direction becomes a rectangle with positive sides. */
export function rectFromDrag(start: Point, end: Point): Rect {
  return clampRect({
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  });
}

export function isUsableRect(rect: Rect): boolean {
  return rect.width >= MIN_MASK_SIZE && rect.height >= MIN_MASK_SIZE;
}

/**
 * Reading order: down the diagram, then across.
 *
 * Banded rather than sorted strictly by `y`, because labels that look level
 * are never level to the pixel, and keyboard navigation that jumps back and
 * forth across a diagram is worse than no keyboard navigation.
 */
export const BAND_HEIGHT = 8;

export function readingOrder<T extends Rect>(masks: T[]): T[] {
  return [...masks].sort((a, b) => {
    const bandA = Math.floor(a.y / BAND_HEIGHT);
    const bandB = Math.floor(b.y / BAND_HEIGHT);
    if (bandA !== bandB) return bandA - bandB;
    return a.x - b.x;
  });
}

/**
 * What is wrong with a set of masks, in words a student can act on.
 *
 * Returned as a list rather than thrown: the editor shows all of them at once
 * instead of making someone fix one problem per save.
 */
export function validateMasks(masks: OcclusionMask[]): string[] {
  const problems: string[] = [];

  if (masks.length === 0) {
    problems.push("Draw at least one box over a label you want to recall.");
  }

  const unlabelled = masks.filter((mask) => !mask.label.trim()).length;
  if (unlabelled > 0) {
    problems.push(
      `${unlabelled} box${unlabelled === 1 ? " has" : "es have"} no label yet — a hidden box with nothing underneath cannot be answered.`,
    );
  }

  const tiny = masks.filter((mask) => !isUsableRect(mask)).length;
  if (tiny > 0) {
    problems.push(
      `${tiny} box${tiny === 1 ? " is" : "es are"} too small to click. Draw over the whole label.`,
    );
  }

  if (new Set(masks.map((mask) => mask.id)).size !== masks.length) {
    problems.push("Two boxes share an id, which would reveal them together.");
  }

  return problems;
}

export type MaskResult = "recalled" | "missed";

/**
 * One self-grade for the whole diagram.
 *
 * A diagram is one card, so it gets one grade — but treating eleven labels
 * with one missed as a total failure would reset work that was mostly right,
 * and treating it as a pass would credit recall that did not happen. So the
 * middle grade covers the middle case, and an unanswered label counts as
 * missed: skipping is not recalling.
 */
export const PARTIAL_THRESHOLD = 0.7;

export function gradeForDrill(
  masks: OcclusionMask[],
  results: Record<string, MaskResult>,
): { recalled: number; missed: number; grade: "missed" | "difficult" | "easy" } {
  const recalled = masks.filter((mask) => results[mask.id] === "recalled").length;
  const missed = masks.length - recalled;

  if (masks.length === 0) return { recalled: 0, missed: 0, grade: "missed" };

  const share = recalled / masks.length;
  const grade =
    share === 1 ? "easy" : share >= PARTIAL_THRESHOLD ? "difficult" : "missed";

  return { recalled, missed, grade };
}

/** The answer text for a drill, used when it is shown as an ordinary card. */
export function labelSummary(masks: OcclusionMask[]): string {
  return readingOrder(masks)
    .map((mask) => mask.label.trim())
    .filter(Boolean)
    .join(", ");
}
