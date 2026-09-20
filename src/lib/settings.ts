/**
 * Local settings (API key, and whatever follows it).
 *
 * Uses the bundler-free client rather than the `server-only` singleton so that
 * CLI scripts and the Electron main process can read the same values the web
 * app does.
 *
 * The key is stored in the local database in the user's own application-data
 * directory. It is not encrypted — doing that properly needs an OS keychain,
 * and pretending otherwise would be worse than saying so — but it never
 * crosses to the browser: callers get only whether a key is present and its
 * last four characters.
 */
import { eq } from "drizzle-orm";

import { createClient, type Db } from "@/db/client";
import { appSettings } from "@/db/schema";

export const GEMINI_KEY = "gemini_api_key";

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

/**
 * The Gemini key, from the environment first.
 *
 * Environment wins so a developer's `.env.local` still overrides whatever a
 * packaged app happens to have saved.
 */
export function resolveGeminiKey(db?: Db): string | undefined {
  return process.env.GEMINI_API_KEY?.trim() || readSetting(GEMINI_KEY, db) || undefined;
}

export type KeyStatus = {
  present: boolean;
  /** Last four characters, so a student can tell which key is saved. */
  hint: string | null;
  fromEnvironment: boolean;
};

export function geminiKeyStatus(db?: Db): KeyStatus {
  const fromEnvironment = Boolean(process.env.GEMINI_API_KEY?.trim());
  const key = resolveGeminiKey(db);

  return {
    present: Boolean(key),
    hint: key ? key.slice(-4) : null,
    fromEnvironment,
  };
}
