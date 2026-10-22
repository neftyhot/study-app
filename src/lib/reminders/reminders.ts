/**
 * Review reminders on desktop: reading the setting and counting what is due.
 * The rules and the wording are shared with iOS in `@megan/core/reminders`.
 * The app has to be running to send one; "open at login" (also off by
 * default) is how a student makes sure it is, and that switch lives with the
 * operating system, not here.
 */
import { and, count, eq, isNotNull, isNull, lte } from "drizzle-orm";

import type { Db } from "@/db/client";
import { flashcards, studyProgress } from "@/db/schema";
import { readSetting, writeSetting } from "@/lib/settings";
import { todayIso } from "@/lib/srs/schedule";
import {
  parseReminders,
  REMINDERS_SETTING_KEY as SETTING_KEY,
  sanitizeReminders,
  type Reminders,
} from "@megan/core/reminders/reminders";

export * from "@megan/core/reminders/reminders";

export function readReminders(db?: Db): Reminders {
  return parseReminders(readSetting(SETTING_KEY, db));
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
