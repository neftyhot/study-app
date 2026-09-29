/**
 * The developer's remote switches: maintenance mode, pausing AI, turning one
 * AI feature off, and refusing AI to versions too old to use it safely.
 *
 * The server's `GET /status` (workers/licensing/src/status.ts) is checked
 * every few minutes and the answer kept in settings, so it holds while the
 * student is offline. An install that has never reached the server runs
 * normally: these switches exist to stop harm, never to lock anyone out of
 * studying. Cards, decks and guides already made always stay open.
 */
import type { Db } from "@/db/client";
import { APP_VERSION, compareVersions, serverUrl } from "@/lib/app-info";
import type { UsageFeature } from "@/lib/llm/types";
import { readSetting, writeSetting } from "@/lib/settings";

export const STATUS_MODES = ["normal", "ai_paused", "maintenance"] as const;
export type StatusMode = (typeof STATUS_MODES)[number];

/** Switchable groups of AI features; the License Manager shows these names. */
export const STATUS_FEATURES = ["decks", "guides", "tutor", "grading", "explain", "search"] as const;
export type StatusFeature = (typeof STATUS_FEATURES)[number];

export const FEATURE_LABELS: Record<StatusFeature, string> = {
  decks: "Making flashcards",
  guides: "Writing study guides",
  tutor: "The tutor",
  grading: "Grading answers and hints",
  explain: "Card explanations",
  search: "Search",
};

const FEATURE_GROUP: Record<UsageFeature, StatusFeature> = {
  generate: "decks",
  coverage: "decks",
  topics: "decks",
  exam_rewrite: "decks",
  primer: "guides",
  primer_example: "guides",
  counter_example: "guides",
  tutor: "tutor",
  tutor_extract: "tutor",
  grade: "grading",
  hint: "grading",
  diagnose: "grading",
  explain: "explain",
  search: "search",
};

export type AppStatus = {
  mode: StatusMode;
  message: string;
  minVersion: string | null;
  features: Partial<Record<StatusFeature, false>>;
  until: number | null;
  updatedAt: number;
};

export const NORMAL_STATUS: AppStatus = {
  mode: "normal",
  message: "",
  minVersion: null,
  features: {},
  until: null,
  updatedAt: 0,
};

const STATUS_KEY = "app_status";
const CHECKED_KEY = "app_status_checked_at";
/** Fast enough that a switch thrown in an emergency lands within minutes. */
export const STATUS_CHECK_MS = 2 * 60 * 1000;

/** The same rules the server applies, so a stored or odd answer cannot confuse the app. */
export function parseStatus(input: unknown): AppStatus {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const mode = STATUS_MODES.find((m) => m === raw.mode) ?? "normal";
  const features: AppStatus["features"] = {};
  if (raw.features && typeof raw.features === "object") {
    for (const key of STATUS_FEATURES) {
      if ((raw.features as Record<string, unknown>)[key] === false) features[key] = false;
    }
  }
  return {
    mode,
    message: typeof raw.message === "string" ? raw.message.slice(0, 500) : "",
    minVersion: typeof raw.minVersion === "string" && /^\d+\.\d+\.\d+$/.test(raw.minVersion) ? raw.minVersion : null,
    features,
    until: typeof raw.until === "number" && Number.isFinite(raw.until) ? raw.until : null,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
  };
}

/**
 * The status in force now: the last one heard, with a mode whose `until` has
 * passed treated as over (the rest of it — message, switches — stays).
 */
export function readAppStatus(db?: Db, now = Date.now()): AppStatus {
  let status = NORMAL_STATUS;
  try {
    const stored = readSetting(STATUS_KEY, db);
    if (stored) status = parseStatus(JSON.parse(stored));
  } catch {
    status = NORMAL_STATUS;
  }
  if (status.until !== null && now >= status.until) return { ...status, mode: "normal", until: null };
  return status;
}

export function needsUpdate(status: AppStatus, version = APP_VERSION): boolean {
  return status.minVersion !== null && compareVersions(version, status.minVersion) < 0;
}

/** Why AI is off for this call, as a sentence for the student; null when it is on. */
export function aiBlockReason(status: AppStatus, feature?: UsageFeature, version = APP_VERSION): string | null {
  const note = status.message.trim();
  if (status.mode === "maintenance") {
    return note || "Megan Study is under maintenance, so AI features are off for now. Everything you've already made still works.";
  }
  if (status.mode === "ai_paused") {
    return note || "AI features are paused for a little while. Everything you've already made still works.";
  }
  if (needsUpdate(status, version)) {
    return `This version needs an update before it can use AI again. Update to ${status.minVersion} or newer from Settings; everything you've already made still works.`;
  }
  if (feature && status.features[FEATURE_GROUP[feature]] === false) {
    return `${FEATURE_LABELS[FEATURE_GROUP[feature]]} is switched off for now while it is being fixed. Everything else still works.`;
  }
  return null;
}

/** True when any AI is off, for the banner. */
export function aiRestricted(status: AppStatus, version = APP_VERSION): boolean {
  return aiBlockReason(status, undefined, version) !== null || Object.keys(status.features).length > 0;
}

let inFlight: Promise<AppStatus> | null = null;

/**
 * Asks the server, at most every STATUS_CHECK_MS unless forced. Quiet on
 * failure: offline keeps the last answer. Returns the status in force.
 */
export async function refreshAppStatus(
  db?: Db,
  { now = Date.now(), force = false }: { now?: number; force?: boolean } = {},
): Promise<AppStatus> {
  const base = serverUrl();
  if (!base) return readAppStatus(db, now);
  const last = Number(readSetting(CHECKED_KEY, db) ?? 0);
  if (!force && now - last < STATUS_CHECK_MS) return readAppStatus(db, now);
  if (inFlight) return inFlight;

  inFlight = (async () => {
    writeSetting(CHECKED_KEY, String(now), db);
    try {
      const response = await fetch(`${base}/status`, { signal: AbortSignal.timeout(6000), cache: "no-store" });
      if (response.ok) {
        const status = parseStatus(await response.json());
        writeSetting(STATUS_KEY, JSON.stringify(status), db);
      }
    } catch {
      // Offline, or a server without /status yet: keep what we had.
    }
    return readAppStatus(db);
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export const MAINTENANCE_ACK_KEY = "app_status_maintenance_ack";
export const UPDATE_ACK_KEY = "app_status_update_ack";

/** Changes whenever what the layout shows would; the client watcher compares it. */
export function statusSignature(status: AppStatus, version = APP_VERSION): string {
  return JSON.stringify([status.mode, status.updatedAt, needsUpdate(status, version)]);
}

/**
 * Which full-screen notice stands in for the app, if any: maintenance, or an
 * update that is required. Each goes once the student chooses to continue
 * without AI, until the developer posts a new one.
 */
export function blockingScreen(status: AppStatus, db?: Db, version = APP_VERSION): "maintenance" | "update" | null {
  if (status.mode === "maintenance" && readSetting(MAINTENANCE_ACK_KEY, db) !== String(status.updatedAt)) {
    return "maintenance";
  }
  if (needsUpdate(status, version) && readSetting(UPDATE_ACK_KEY, db) !== status.minVersion) return "update";
  return null;
}
