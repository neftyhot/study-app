/**
 * The first-week funnel: which first steps this install has taken.
 *
 * Each step is recorded once, the first time it happens, and only its name
 * goes in the usage report — no times, no content. The first generation also
 * reports a coarse duration bucket, a failed one only an error category, and
 * the "how did you hear about us" answer one of a fixed list. Everything sent
 * is from a closed set, so the report can never carry what a student typed.
 */
import type { Db } from "@/db/client";
import { readSetting, writeSetting } from "@/lib/settings";
import { isSource, SOURCES, type Source } from "@/lib/sources";

export { isSource, SOURCE_LABELS, SOURCES, type Source } from "@/lib/sources";

export const FUNNEL_EVENTS = [
  "first_launch",
  "privacy_accepted",
  "trial_started",
  "sample_deck_opened",
  "key_prompt_shown",
  "key_added",
  "key_validated",
  "first_deck_created",
  "first_generation_started",
  "first_generation_completed",
  "first_generation_failed",
  "first_study_session",
  "returned_day_1",
  "returned_day_7",
  "purchased",
] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

export const GENERATION_BUCKETS = ["<1m", "1-3m", "3-10m", ">10m"] as const;
export type GenerationBucket = (typeof GENERATION_BUCKETS)[number];

/** A failed first generation, by kind only. */
export const GENERATION_ERRORS = ["key", "quota", "network", "file", "model", "other"] as const;
export type GenerationError = (typeof GENERATION_ERRORS)[number];

const FUNNEL_KEY = "funnel";
const DAY_MS = 24 * 60 * 60 * 1000;

type FunnelState = {
  /** Event name → when it first happened. Kept on this machine only. */
  events: Partial<Record<FunnelEvent, string>>;
  generationBucket?: GenerationBucket;
  generationError?: GenerationError;
  source?: Source;
};

function read(db: Db): FunnelState {
  try {
    const parsed = JSON.parse(readSetting(FUNNEL_KEY, db) ?? "{}") as Partial<FunnelState>;
    return {
      events: parsed.events && typeof parsed.events === "object" ? parsed.events : {},
      generationBucket: GENERATION_BUCKETS.find((b) => b === parsed.generationBucket),
      generationError: GENERATION_ERRORS.find((e) => e === parsed.generationError),
      source: SOURCES.find((s) => s === parsed.source),
    };
  } catch {
    return { events: {} };
  }
}

function write(db: Db, state: FunnelState) {
  writeSetting(FUNNEL_KEY, JSON.stringify(state), db);
}

export function generationBucket(ms: number): GenerationBucket {
  if (ms < 60_000) return "<1m";
  if (ms < 3 * 60_000) return "1-3m";
  if (ms < 10 * 60_000) return "3-10m";
  return ">10m";
}

/** A failure's message, sorted into a category. The message itself never leaves. */
export function generationErrorCategory(message: string): GenerationError {
  const m = message.toLowerCase();
  if (/api key|invalid key|unauthori[sz]ed|permission|401|403/.test(m)) return "key";
  if (/quota|rate limit|429|exhausted|too many/.test(m)) return "quota";
  if (/network|fetch failed|timed? ?out|econn|offline|unreachable/.test(m)) return "network";
  if (/file|pdf|slide|upload|unsupported|too large|could not read/.test(m)) return "file";
  if (/model|overloaded|503|500|safety|blocked/.test(m)) return "model";
  return "other";
}

/**
 * Records a step the first time it happens; later calls do nothing. Never
 * throws — the funnel must never get in the way of the thing it counts.
 */
export function recordFunnel(
  db: Db,
  event: FunnelEvent,
  extra: { durationMs?: number; error?: string } = {},
  now = new Date(),
): boolean {
  try {
    const state = read(db);
    if (state.events[event]) return false;
    state.events[event] = now.toISOString();
    if (event === "first_generation_completed" && extra.durationMs !== undefined) {
      state.generationBucket = generationBucket(extra.durationMs);
    }
    if (event === "first_generation_failed" && extra.error !== undefined) {
      state.generationError = generationErrorCategory(extra.error);
    }
    write(db, state);
    return true;
  } catch {
    return false;
  }
}

export function hasFunnel(db: Db, event: FunnelEvent): boolean {
  return Boolean(read(db).events[event]);
}

/** Where the student heard about the app; the first answer stands. */
export function recordSource(db: Db, source: unknown): boolean {
  if (!isSource(source)) return false;
  const state = read(db);
  if (state.source) return false;
  state.source = source;
  write(db, state);
  return true;
}

export function readSource(db: Db): Source | null {
  return read(db).source ?? null;
}

/** Coming back a day, and a week, after first launch. Called with each report. */
export function noteReturns(db: Db, now = new Date()) {
  const first = Date.parse(read(db).events.first_launch ?? "");
  if (!Number.isFinite(first)) return;
  const since = now.getTime() - first;
  if (since >= DAY_MS) recordFunnel(db, "returned_day_1", {}, now);
  if (since >= 7 * DAY_MS) recordFunnel(db, "returned_day_7", {}, now);
}

/** What the usage report carries: names and categories only, in a fixed order. */
export function funnelReport(db: Db) {
  const state = read(db);
  return {
    events: FUNNEL_EVENTS.filter((event) => state.events[event]),
    generationBucket: state.generationBucket ?? null,
    generationError: state.generationError ?? null,
    source: state.source ?? null,
  };
}
