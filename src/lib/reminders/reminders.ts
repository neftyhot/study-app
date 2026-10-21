/**
 * Review reminders: one system notification a day, at a time the student
 * picks, saying how many cards are due. Off until turned on.
 *
 * The notification says a count and nothing else — no deck names, no card
 * text — because it shows on a lock screen. The app has to be running to
 * send one; "open at login" (also off by default) is how a student makes
 * sure it is, and that switch lives with the operating system, not here.
 */
import { and, count, eq, isNotNull, isNull, lte } from "drizzle-orm";

import type { Db } from "@/db/client";
import { flashcards, studyProgress } from "@/db/schema";
import { readSetting, writeSetting } from "@/lib/settings";
import { todayIso } from "@/lib/srs/schedule";

export type Reminders = {
  enabled: boolean;
  /** Local time of day, "HH:MM". */
  time: string;
};

export const DEFAULT_REMINDERS: Reminders = { enabled: false, time: "18:00" };
const SETTING_KEY = "review_reminders";
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function sanitizeReminders(value: unknown): Reminders {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_REMINDERS };
  const raw = value as Record<string, unknown>;
  return {
    enabled: raw.enabled === true,
    time: typeof raw.time === "string" && TIME.test(raw.time) ? raw.time : DEFAULT_REMINDERS.time,
  };
}

export function readReminders(db?: Db): Reminders {
  const raw = readSetting(SETTING_KEY, db);
  if (!raw) return { ...DEFAULT_REMINDERS };
  try {
    return sanitizeReminders(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_REMINDERS };
  }
}

export function writeReminders(value: unknown, db?: Db): Reminders {
  const clean = sanitizeReminders(value);
  writeSetting(SETTING_KEY, JSON.stringify(clean), db);
  return clean;
}

/** Every card due today or earlier, across all decks. */
export function countAllDue(db: Db, today = todayIso()): number {
  const row = db
    .select({ n: count() })
    .from(studyProgress)
    .innerJoin(flashcards, eq(flashcards.id, studyProgress.flashcardId))
    .where(
      and(
        eq(flashcards.excluded, false),
        isNull(flashcards.deletedAt),
        isNotNull(studyProgress.nextReviewDue),
        lte(studyProgress.nextReviewDue, today),
      ),
    )
    .get();
  return row?.n ?? 0;
}

/**
 * Whether to send today's reminder now. Once a day at most, only after the
 * chosen time, and never for nothing due. A reminder missed because the app
 * was closed is sent when it next opens that same day, not on a later day.
 */
export function shouldRemind(
  reminders: Reminders,
  due: number,
  now: Date,
  lastSentDay: string | null,
): boolean {
  if (!reminders.enabled || due <= 0) return false;
  const today = todayIso(now);
  if (lastSentDay === today) return false;
  const [hours, minutes] = reminders.time.split(":").map(Number);
  return now.getHours() * 60 + now.getMinutes() >= hours * 60 + minutes;
}

/** The notification's words. A count only: it can show on a lock screen. */
export function reminderMessage(due: number): { title: string; body: string } {
  return {
    title: "Time to review",
    body: due === 1 ? "1 card is due today." : `${due} cards are due today.`,
  };
}
