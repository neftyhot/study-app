/**
 * The developer's switches for every install, read by the app every few
 * minutes (src/lib/app-status.ts):
 *
 *   GET /status         Public. What the app should allow right now.
 *   PUT /admin/status   Sets it (License Manager's App status tab); see
 *                       sanitizeStatus. Returns what was stored.
 *
 * Modes, least to most drastic:
 *   normal       Everything on (a `message` still shows as a banner).
 *   ai_paused    Studying works; every AI call is refused.
 *   maintenance  A full-screen notice; the student may continue to what is
 *                already made, with AI off.
 *
 * Also: `features` turns single AI features off, `minVersion` refuses AI to
 * older versions until they update, and `until` ends a pause or maintenance
 * window by itself.
 */
import type { InsightsEnv } from "./insights";

export const STATUS_KEY = "status";
export const STATUS_MODES = ["normal", "ai_paused", "maintenance"] as const;
export const STATUS_FEATURES = ["decks", "guides", "tutor", "grading", "explain", "search"] as const;

export type AppStatus = {
  mode: (typeof STATUS_MODES)[number];
  message: string;
  minVersion: string | null;
  /** Only switched-off features appear, as `false`. */
  features: Partial<Record<(typeof STATUS_FEATURES)[number], false>>;
  /** Epoch ms after which mode reverts to normal; null for "until changed". */
  until: number | null;
  updatedAt: number;
};

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const MESSAGE_MAX = 500;

export const NORMAL_STATUS: AppStatus = {
  mode: "normal",
  message: "",
  minVersion: null,
  features: {},
  until: null,
  updatedAt: 0,
};

/** Keeps only what the app understands; anything odd falls back to "normal". */
export function sanitizeStatus(body: unknown, now = Date.now()): AppStatus {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const mode = STATUS_MODES.find((m) => m === input.mode) ?? "normal";
  const message = typeof input.message === "string" ? input.message.trim().slice(0, MESSAGE_MAX) : "";
  const minVersion = typeof input.minVersion === "string" && VERSION.test(input.minVersion.trim()) ? input.minVersion.trim() : null;

  const features: AppStatus["features"] = {};
  const given = input.features;
  if (given && typeof given === "object") {
    for (const key of STATUS_FEATURES) {
      if ((given as Record<string, unknown>)[key] === false) features[key] = false;
    }
  }

  let until: number | null = null;
  const rawUntil = typeof input.until === "string" ? Date.parse(input.until) : input.until;
  if (typeof rawUntil === "number" && Number.isFinite(rawUntil) && rawUntil > now) until = Math.round(rawUntil);

  return { mode, message, minVersion, features, until, updatedAt: now };
}

/** Short cache: a switch thrown in an emergency should reach everyone within minutes. */
export async function handleStatus(env: InsightsEnv): Promise<Response> {
  let status: AppStatus = NORMAL_STATUS;
  try {
    const raw = await env.LICENSES.get(STATUS_KEY);
    if (raw) status = { ...NORMAL_STATUS, ...(JSON.parse(raw) as Partial<AppStatus>) };
  } catch {
    status = NORMAL_STATUS;
  }
  return Response.json(status, { headers: { "Cache-Control": "public, max-age=60" } });
}

export async function handleStatusUpdate(request: Request, env: InsightsEnv): Promise<Response> {
  let body: unknown;
  try {
    body = JSON.parse((await request.text()).slice(0, 20_000));
  } catch {
    return new Response("Bad payload", { status: 400 });
  }
  const status = sanitizeStatus(body);
  await env.LICENSES.put(STATUS_KEY, JSON.stringify(status));
  return Response.json(status);
}
