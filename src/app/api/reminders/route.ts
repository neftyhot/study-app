/**
 * GET /api/reminders?last=YYYY-MM-DD — whether to send today's review
 * reminder now, and its words. Asked by the desktop app's main process
 * (electron/reminders.cjs), which remembers the day it last sent one.
 *
 * Answers with a count only; card text never leaves the database here.
 */
import { NextResponse } from "next/server";

import { db } from "@/db";
import { countAllDue, readReminders, reminderMessage, shouldRemind } from "@/lib/reminders/reminders";
import { todayIso } from "@/lib/srs/schedule";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const last = new URL(request.url).searchParams.get("last");
  const reminders = readReminders(db);
  if (!reminders.enabled) return NextResponse.json({ remind: false });

  const now = new Date();
  const due = countAllDue(db, todayIso(now));
  if (!shouldRemind(reminders, due, now, last)) return NextResponse.json({ remind: false });
  return NextResponse.json({ remind: true, day: todayIso(now), ...reminderMessage(due) });
}
