"use server";

import { db } from "@/db";
import { APP_VERSION, compareVersions, RELEASES_REPO, serverUrl } from "@/lib/app-info";
import { readSetting, writeSetting } from "@/lib/settings";
import { recordTime } from "@/lib/stats";
import { maybeSendReport } from "@/lib/telemetry";

/** The window reporting how long it has been open, focused or not. */
export async function recordTimeAction(focused: number, background: number) {
  recordTime(db, focused, background);
  // Piggybacks on the minute tick; sends only if opted in and 6h have passed.
  void maybeSendReport(db);
}

/* --------------------------------------------------------------- Feedback */

const OUTBOX_KEY = "feedback_outbox";

type Suggestion = { text: string; contact: string | null; version: string; writtenAt: string };

async function deliver(suggestion: Suggestion): Promise<boolean> {
  const base = serverUrl();
  if (!base) return false;
  try {
    const response = await fetch(`${base}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(suggestion),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Sends a suggestion to the developer.
 *
 * Offline, or with the server unreachable, it is kept and sent with the next
 * one, so nothing typed is lost.
 */
export async function sendFeedbackAction(text: string, contact: string) {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false as const, error: "Write something first." };

  let outbox: Suggestion[] = [];
  try {
    outbox = JSON.parse(readSetting(OUTBOX_KEY, db) ?? "[]");
  } catch {
    outbox = [];
  }

  outbox.push({
    text: trimmed.slice(0, 5000),
    contact: contact.trim().slice(0, 200) || null,
    version: APP_VERSION,
    writtenAt: new Date().toISOString(),
  });

  const left: Suggestion[] = [];
  for (const suggestion of outbox) {
    if (!(await deliver(suggestion))) left.push(suggestion);
  }
  writeSetting(OUTBOX_KEY, left.length > 0 ? JSON.stringify(left.slice(-50)) : "", db);

  return { ok: true as const, queued: left.length };
}

/* ---------------------------------------------------------------- Updates */

let cached: { at: number; result: UpdateInfo | null } | null = null;
const CACHE_MS = 6 * 60 * 60 * 1000;

export type UpdateInfo = { version: string; url: string; download: string | null };

/** A newer release on GitHub, if there is one. Quiet when offline. */
export async function checkForUpdateAction(): Promise<UpdateInfo | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.result;

  let result: UpdateInfo | null = null;
  try {
    const response = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const release = (await response.json()) as {
        tag_name?: string;
        html_url?: string;
        assets?: { name: string; browser_download_url: string }[];
      };
      const version = release.tag_name?.replace(/^v/, "") ?? "";
      if (version && compareVersions(version, APP_VERSION) > 0) {
        const dmg = release.assets?.find((asset) => asset.name.endsWith(".dmg"));
        result = {
          version,
          url: release.html_url ?? `https://github.com/${RELEASES_REPO}/releases/latest`,
          download: dmg?.browser_download_url ?? null,
        };
      }
    }
  } catch {
    // Offline or rate-limited: say nothing rather than something wrong.
    return null;
  }

  cached = { at: Date.now(), result };
  return result;
}
