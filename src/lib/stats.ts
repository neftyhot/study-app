/**
 * The numbers on Settings → Your stats.
 *
 * Counted straight from the database each time the page loads — nothing here
 * is worth a cache — except time in the app, which the window reports as it
 * goes (see `components/layout/time-tracker.tsx`) and is kept in settings.
 */
import { count, eq, isNull, and } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  answerAttempts,
  courses,
  exams,
  flashcards,
  practiceExams,
  sourceSlides,
  studyProgress,
  studySessions,
} from "@/db/schema";
import { readSetting, writeSetting } from "@/lib/settings";

const FOCUSED_KEY = "time_focused_seconds";
const BACKGROUND_KEY = "time_background_seconds";
const SINCE_KEY = "time_tracked_since";

/** Longest a single report may claim, so a stalled tab cannot add hours. */
export const MAX_REPORT_SECONDS = 5 * 60;

export function recordTime(db: Db, focused: number, background: number) {
  const clamp = (value: number) =>
    Number.isFinite(value) ? Math.min(MAX_REPORT_SECONDS, Math.max(0, Math.round(value))) : 0;

  const add = (key: string, seconds: number) => {
    if (seconds === 0) return;
    const current = Number(readSetting(key, db) ?? 0) || 0;
    writeSetting(key, String(current + seconds), db);
  };

  add(FOCUSED_KEY, clamp(focused));
  add(BACKGROUND_KEY, clamp(background));
  if (!readSetting(SINCE_KEY, db)) writeSetting(SINCE_KEY, new Date().toISOString(), db);
}

/** SQLite's `current_timestamp` is UTC with a space and no zone. */
export function parseStamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Current and longest runs of consecutive days with any studying.
 *
 * The current streak survives until the end of today: studied yesterday but
 * not yet today still counts, since today is not over.
 */
export function streaks(days: Iterable<string>, today: Date = new Date()) {
  const set = new Set(days);
  const sorted = [...set].sort();

  let longest = 0;
  let run = 0;
  let previous: Date | null = null;
  for (const day of sorted) {
    const date = new Date(`${day}T12:00:00`);
    run = previous && Math.round((date.getTime() - previous.getTime()) / 86_400_000) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = date;
  }

  let current = 0;
  const cursor = new Date(today);
  if (!set.has(localDay(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (set.has(localDay(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { current, longest };
}

export type AppStats = ReturnType<typeof loadStats>;

export function loadStats(db: Db) {
  const one = <T,>(rows: T[]) => rows[0];

  const subjects = one(db.select({ n: count() }).from(courses).all())?.n ?? 0;
  const decks = one(db.select({ n: count() }).from(exams).all())?.n ?? 0;
  const cards = one(db.select({ n: count() }).from(flashcards).all())?.n ?? 0;
  const handwritten =
    one(
      db
        .select({ n: count() })
        .from(flashcards)
        .where(and(isNull(flashcards.sourceSlideId), eq(flashcards.isUserEdited, true)))
        .all(),
    )?.n ?? 0;
  const pages = one(db.select({ n: count() }).from(sourceSlides).all())?.n ?? 0;
  const retained =
    one(
      db.select({ n: count() }).from(studyProgress).where(eq(studyProgress.state, "retained")).all(),
    )?.n ?? 0;

  const sessions = db
    .select({
      examId: studySessions.examId,
      startedAt: studySessions.startedAt,
      updatedAt: studySessions.updatedAt,
      missed: studySessions.missedCount,
      difficult: studySessions.difficultCount,
      easy: studySessions.easyCount,
    })
    .from(studySessions)
    .all();

  const attempts = db
    .select({ createdAt: answerAttempts.createdAt, verdict: answerAttempts.verdict })
    .from(answerAttempts)
    .all();

  const papers = db
    .select({
      status: practiceExams.status,
      score: practiceExams.score,
      questions: practiceExams.questionCount,
      startedAt: practiceExams.startedAt,
    })
    .from(practiceExams)
    .all();

  // Flashcard flips, graded by the student; Learn and exam answers, graded
  // by the app.
  const flips = sessions.reduce((sum, s) => sum + s.missed + s.difficult + s.easy, 0);
  const flipsKnown = sessions.reduce((sum, s) => sum + s.difficult + s.easy, 0);
  const correctAttempts = attempts.filter((a) => a.verdict === "correct").length;
  const reviewed = flips + attempts.length;
  const accuracy =
    reviewed > 0 ? Math.round(((flipsKnown + correctAttempts) / reviewed) * 100) : null;

  const moments = [
    ...sessions.flatMap((s) => [s.startedAt, s.updatedAt]),
    ...attempts.map((a) => a.createdAt),
    ...papers.map((p) => p.startedAt),
  ]
    .map(parseStamp)
    .filter((date): date is Date => date !== null);

  const hours = new Array(24).fill(0) as number[];
  for (const moment of moments) hours[moment.getHours()] += 1;
  const peak = moments.length > 0 ? hours.indexOf(Math.max(...hours)) : null;

  const perDeck = new Map<string, number>();
  for (const s of sessions) {
    perDeck.set(s.examId, (perDeck.get(s.examId) ?? 0) + s.missed + s.difficult + s.easy);
  }
  const [topDeckId, topDeckReviews] = [...perDeck.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  const topDeck = topDeckId
    ? db.select({ title: exams.title }).from(exams).where(eq(exams.id, topDeckId)).get()?.title ?? null
    : null;

  const submitted = papers.filter((p) => p.status === "submitted" && p.questions > 0);
  const bestPaper = submitted.length
    ? Math.max(...submitted.map((p) => Math.round(((p.score ?? 0) / p.questions) * 100)))
    : null;

  return {
    subjects,
    decks,
    cards,
    handwritten,
    pages,
    retained,
    reviewed,
    accuracy,
    streak: streaks(moments.map(localDay)),
    peakHour: peak,
    topDeck: topDeck ? { title: topDeck, reviews: topDeckReviews ?? 0 } : null,
    papers: submitted.length,
    bestPaper,
    focusedSeconds: Number(readSetting(FOCUSED_KEY, db) ?? 0) || 0,
    backgroundSeconds: Number(readSetting(BACKGROUND_KEY, db) ?? 0) || 0,
    trackedSince: readSetting(SINCE_KEY, db),
  };
}
