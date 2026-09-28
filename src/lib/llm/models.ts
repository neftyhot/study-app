/**
 * Which model name each role asks for.
 *
 * Model names retire faster than students update, so the developer's server can
 * name newer ones (`GET /config`) without a release. Order of precedence: an
 * environment variable (for development), then the server's choice, then the
 * name built into this version.
 */
import type { Db } from "@/db/client";
import { serverUrl } from "@/lib/app-info";
import { readSetting, writeSetting } from "@/lib/settings";

import { DEFAULT_ANTHROPIC_MODEL } from "./anthropic";
import { DEFAULT_GEMINI_BULK_MODEL, DEFAULT_GEMINI_MODEL } from "./gemini";
import { DEFAULT_OPENAI_MODEL } from "./openai";

export type ModelSlot = "anthropic" | "openai" | "gemini" | "geminiBulk" | "geminiPrimer";

/**
 * The Primer is one long read of the whole deck. It runs on Flash like
 * everything else: free on the free tier, and a better read than Flash-Lite.
 */
export const DEFAULT_GEMINI_PRIMER_MODEL = DEFAULT_GEMINI_MODEL;

export const BUILT_IN_MODELS: Record<ModelSlot, string> = {
  anthropic: DEFAULT_ANTHROPIC_MODEL,
  openai: DEFAULT_OPENAI_MODEL,
  gemini: DEFAULT_GEMINI_MODEL,
  geminiBulk: DEFAULT_GEMINI_BULK_MODEL,
  geminiPrimer: DEFAULT_GEMINI_PRIMER_MODEL,
};

const ENV: Record<ModelSlot, string> = {
  anthropic: "ANTHROPIC_MODEL",
  openai: "OPENAI_MODEL",
  gemini: "GEMINI_MODEL",
  geminiBulk: "GEMINI_BULK_MODEL",
  geminiPrimer: "GEMINI_PRIMER_MODEL",
};

const REMOTE_KEY = "remote_models";
const CHECKED_KEY = "remote_models_checked_at";
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

/** A model name is short and plain; anything else from the wire is ignored. */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,99}$/;

export function sanitizeModels(value: unknown): Partial<Record<ModelSlot, string>> {
  if (!value || typeof value !== "object") return {};
  const out: Partial<Record<ModelSlot, string>> = {};
  for (const slot of Object.keys(BUILT_IN_MODELS) as ModelSlot[]) {
    const name = (value as Record<string, unknown>)[slot];
    if (typeof name === "string" && MODEL_NAME.test(name)) out[slot] = name;
  }
  return out;
}

function remoteModels(db?: Db): Partial<Record<ModelSlot, string>> {
  const raw = readSetting(REMOTE_KEY, db);
  if (!raw) return {};
  try {
    return sanitizeModels(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function modelFor(slot: ModelSlot, db?: Db): string {
  return process.env[ENV[slot]]?.trim() || remoteModels(db)[slot] || BUILT_IN_MODELS[slot];
}

/**
 * Asks the server for its current model names at most once a day. Quiet on
 * failure: the last answer (or the built-in names) keeps working.
 */
export async function refreshRemoteModels(db?: Db, now = Date.now()): Promise<void> {
  const base = serverUrl();
  if (!base) return;
  const last = Number(readSetting(CHECKED_KEY, db) ?? 0);
  if (now - last < CHECK_EVERY_MS) return;
  writeSetting(CHECKED_KEY, String(now), db);
  try {
    const response = await fetch(`${base}/config`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return;
    const payload = (await response.json()) as { models?: unknown };
    const models = sanitizeModels(payload.models);
    writeSetting(REMOTE_KEY, Object.keys(models).length ? JSON.stringify(models) : "", db);
  } catch {
    // Offline or no such route yet; try again tomorrow.
  }
}
