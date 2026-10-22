/**
 * Which days of the week the student studies, stored as a bitmask on the exam
 * (bit 0 is Sunday, bit 6 Saturday).
 *
 * Pure and dependency-free so the schedule form can import it in the browser.
 */

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Every day of the week. */
export const EVERY_DAY = 0b1111111;

/** Monday first, the way a student reads a week. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** An empty or invalid mask means every day: a plan with no days is no plan. */
export function normaliseStudyDays(mask: number | null | undefined): number {
  if (typeof mask !== "number" || !Number.isInteger(mask)) return EVERY_DAY;
  const clean = mask & EVERY_DAY;
  return clean === 0 ? EVERY_DAY : clean;
}

/** 0 (Sunday) to 6 (Saturday) for a YYYY-MM-DD date, independent of time zone. */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isStudyDay(iso: string, mask: number): boolean {
  return (normaliseStudyDays(mask) & (1 << weekdayOf(iso))) !== 0;
}

export function hasWeekday(mask: number, weekday: number): boolean {
  return (mask & (1 << weekday)) !== 0;
}

export function toggleWeekday(mask: number, weekday: number): number {
  return mask ^ (1 << weekday);
}

/** "Every day", "Weekdays", or "Mon, Wed, Fri". */
export function describeStudyDays(mask: number | null | undefined): string {
  const days = normaliseStudyDays(mask);
  if (days === EVERY_DAY) return "every day";
  if (days === 0b0111110) return "weekdays";
  if (days === 0b1000001) return "weekends";
  return WEEK_ORDER.filter((day) => hasWeekday(days, day))
    .map((day) => WEEKDAY_LABELS[day])
    .join(", ");
}
