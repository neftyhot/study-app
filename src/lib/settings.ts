/**
 * Local settings: which model answers, and how to reach it.
 *
 * Uses the bundler-free client rather than the `server-only` singleton so that
 * CLI scripts and the Electron main process read the same values the web app
 * does.
 *
 * API keys are stored in the local database in the user's own application-data
 * directory. They are not encrypted — doing that properly needs an OS keychain,
 * and pretending otherwise would be worse than saying so — but they never cross
 * to the browser: callers get only whether a key is present and its last four
 * characters.
 */
import { eq } from "drizzle-orm";

import { createClient, type Db } from "@/db/client";
import { appSettings } from "@/db/schema";
import {
  DEFAULT_APPEARANCE,
  sanitizeAppearance,
  type Appearance,
} from "@/lib/appearance";
import { hasGoogleSession } from "@/lib/auth/google-session";
import {
  DEFAULT_STRICTNESS,
  isStrictness,
  type Strictness,
} from "@/lib/grade/strictness";
import { PRIVACY_POLICY_VERSION } from "@/lib/privacy-policy";
import {
  PROVIDERS,
  type DownloadState,
  type KeyStatus,
  type ProviderId,
} from "@/lib/settings-shared";

export * from "@/lib/settings-shared";

export const SETTING = {
  provider: "llm_provider",
  setupComplete: "setup_complete",
  localModelId: "local_model_id",
  localModelPath: "local_model_path",
  download: "model_download",
  privacyAccepted: "privacy_policy_accepted",
} as const;

const KEY_SETTING: Record<Exclude<ProviderId, "local">, string> = {
  gemini: "gemini_api_key",
  anthropic: "anthropic_api_key",
  openai: "openai_api_key",
};

const ENV_KEY: Record<Exclude<ProviderId, "local">, string> = {
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/** Kept for the previous single-key setting name. */
export const GEMINI_KEY = KEY_SETTING.gemini;

function client(db?: Db): Db {
  return db ?? createClient();
}

export function readSetting(key: string, db?: Db): string | null {
  try {
    const row = client(db)
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .get();
    return row?.value ?? null;
  } catch {
    // A missing or unmigrated database must not take the app down.
    return null;
  }
}

export function writeSetting(key: string, value: string, db?: Db) {
  const target = client(db);
  const trimmed = value.trim();

  if (!trimmed) {
    target.delete(appSettings).where(eq(appSettings.key, key)).run();
    return;
  }

  target
    .insert(appSettings)
    .values({ key, value: trimmed, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: trimmed, updatedAt: new Date().toISOString() },
    })
    .run();
}

/* -------------------------------------------------------------- Grading */

const STRICTNESS_KEY = "grading_strictness";

export function readGradingStrictness(db?: Db): Strictness {
  const value = readSetting(STRICTNESS_KEY, db);
  return isStrictness(value) ? value : DEFAULT_STRICTNESS;
}

export function writeGradingStrictness(strictness: Strictness, db?: Db) {
  writeSetting(STRICTNESS_KEY, strictness, db);
}

/* ------------------------------------------------------------- Appearance */

const APPEARANCE_KEY = "appearance";

export function readAppearance(db?: Db): Appearance {
  const raw = readSetting(APPEARANCE_KEY, db);
  if (!raw) return DEFAULT_APPEARANCE;
  try {
    return sanitizeAppearance(JSON.parse(raw));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/** Stores it cleaned: nothing reaches the page's CSS that was not checked. */
export function writeAppearance(appearance: unknown, db?: Db): Appearance {
  const clean = sanitizeAppearance(appearance);
  writeSetting(APPEARANCE_KEY, JSON.stringify(clean), db);
  return clean;
}

/* ------------------------------------------------------------------- Keys */

export function readApiKey(
  provider: Exclude<ProviderId, "local">,
  db?: Db,
): string | undefined {
  // The environment wins, so a developer's .env.local still overrides
  // whatever a packaged app happens to have saved.
  const fromEnv = process.env[ENV_KEY[provider]]?.trim();
  return fromEnv || readSetting(KEY_SETTING[provider], db) || undefined;
}

export function writeApiKey(
  provider: Exclude<ProviderId, "local">,
  key: string,
  db?: Db,
) {
  writeSetting(KEY_SETTING[provider], key, db);
}

export function apiKeyStatus(
  provider: Exclude<ProviderId, "local">,
  db?: Db,
): KeyStatus {
  const fromEnvironment = Boolean(process.env[ENV_KEY[provider]]?.trim());
  const key = readApiKey(provider, db);

  return {
    provider,
    present: Boolean(key),
    hint: key ? key.slice(-4) : null,
    fromEnvironment,
  };
}

export function allKeyStatuses(db?: Db): KeyStatus[] {
  return (["gemini", "anthropic", "openai"] as const).map((provider) =>
    apiKeyStatus(provider, db),
  );
}

/** Kept so existing callers of the Gemini-only helper keep working. */
export function resolveGeminiKey(db?: Db): string | undefined {
  return readApiKey("gemini", db);
}

export function geminiKeyStatus(db?: Db): KeyStatus {
  return apiKeyStatus("gemini", db);
}

/* --------------------------------------------------------------- Provider */

export function readProvider(db?: Db): ProviderId {
  const stored = readSetting(SETTING.provider, db);
  return PROVIDERS.includes(stored as ProviderId)
    ? (stored as ProviderId)
    : "gemini";
}

export function writeProvider(provider: ProviderId, db?: Db) {
  writeSetting(SETTING.provider, provider, db);
}

/* --------------------------------------------------------------- Download */

export function readDownload(db?: Db): DownloadState | null {
  const raw = readSetting(SETTING.download, db);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as DownloadState;
  } catch {
    return null;
  }
}

export function writeDownload(state: DownloadState | null, db?: Db) {
  writeSetting(SETTING.download, state ? JSON.stringify(state) : "", db);
}

export function readLocalModel(db?: Db) {
  return {
    id: readSetting(SETTING.localModelId, db),
    path: readSetting(SETTING.localModelPath, db),
  };
}

/* ------------------------------------------------------------------ Setup */

export function isSetupComplete(db?: Db): boolean {
  return readSetting(SETTING.setupComplete, db) === "1";
}

export function markSetupComplete(db?: Db) {
  writeSetting(SETTING.setupComplete, "1", db);
}

/* ---------------------------------------------------------------- Privacy */

/** Whether the current privacy policy has been agreed to; the app waits until it is. */
export function hasAcceptedPrivacy(db?: Db): boolean {
  return readSetting(SETTING.privacyAccepted, db) === PRIVACY_POLICY_VERSION;
}

export function acceptPrivacy(db?: Db) {
  writeSetting(SETTING.privacyAccepted, PRIVACY_POLICY_VERSION, db);
}

/**
 * Whether the app can currently answer at all.
 *
 * Studying never needs this; generation and typed grading do. The wizard uses
 * it to decide whether the student still has something to set up.
 */
export function isAnswerable(db?: Db): boolean {
  const provider = readProvider(db);
  if (provider === "local") return readDownload(db)?.status === "ready";
  if (provider === "gemini" && hasGoogleSession(db)) return true;
  return Boolean(readApiKey(provider, db));
}
