/**
 * Review reminders on iOS. Unlike the desktop, which has to be running to
 * send one, iOS hands the next week of reminders to the system ahead of time;
 * each carries the number of cards that will be due that day, and every
 * launch or grade session reschedules them so the numbers stay fresh.
 */
import type { Notifier, Reminder, SqlDriver } from "@megan/core/platform/types";
import {
  parseReminders,
  REMINDERS_SETTING_KEY,
  reminderMessage,
  sanitizeReminders,
  type Reminders,
} from "@megan/core/reminders/reminders";
import { addDays, todayIso } from "@megan/core/srs/schedule";

import { countDueBy } from "./decks";
import { readSetting, writeSetting } from "./settings";

const DAYS_AHEAD = 7;
/** Ids 1000–1006: stable, so rescheduling replaces rather than stacks. */
const IDS = Array.from({ length: DAYS_AHEAD }, (_, i) => 1000 + i);

export async function readReminders(db: SqlDriver): Promise<Reminders> {
  return parseReminders(await readSetting(db, REMINDERS_SETTING_KEY));
}

export async function writeReminders(db: SqlDriver, value: unknown): Promise<Reminders> {
  const clean = sanitizeReminders(value);
  await writeSetting(db, REMINDERS_SETTING_KEY, JSON.stringify(clean));
  return clean;
}

/** The reminders to hand the system: one per day with cards due, at the chosen time. */
export async function planReminders(db: SqlDriver, settings: Reminders, now = new Date()): Promise<Reminder[]> {
  if (!settings.enabled) return [];
  const [hours, minutes] = settings.time.split(":").map(Number);
  const today = todayIso(now);
  const planned: Reminder[] = [];
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const day = addDays(today, i);
    const at = new Date(now);
    at.setDate(now.getDate() + i);
    at.setHours(hours, minutes, 0, 0);
    if (at <= now) continue;
    const due = await countDueBy(db, day);
    if (due === 0) continue;
    const message = reminderMessage(due);
    planned.push({ id: IDS[i], title: message.title, body: message.body, at });
  }
  return planned;
}

/** Cancels the week's reminders and schedules fresh ones. */
export async function rescheduleReminders(db: SqlDriver, notifier: Notifier, now = new Date()): Promise<number> {
  await notifier.cancel(IDS);
  const planned = await planReminders(db, await readReminders(db), now);
  if (planned.length > 0) await notifier.schedule(planned);
  return planned.length;
}
