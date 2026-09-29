"use server";

import { db } from "@/db";
import { APP_VERSION, compareVersions, RELEASES_REPO, serverUrl } from "@/lib/app-info";
import { readSetting, writeSetting } from "@/lib/settings";
import { recordTime } from "@/lib/stats";
import { refreshRemoteModels } from "@/lib/llm/models";
import {
  MAINTENANCE_ACK_KEY,
  needsUpdate,
  readAppStatus,
  refreshAppStatus,
  statusSignature,
  UPDATE_ACK_KEY,
} from "@/lib/app-status";
import { deleteServerStatistics, maybeSendReport } from "@/lib/telemetry";

/** The window reporting how long it has been open, focused or not. */
export async function recordTimeAction(focused: number, background: number) {
  recordTime(db, focused, background);
  // Piggybacks on the minute tick; sends hourly, or soon after counts change.
  void maybeSendReport(db);
  // At most daily: newer model names, so retired ones don't strand old installs.
  void refreshRemoteModels(db);
  // Every couple of minutes: the developer's maintenance and AI switches.
  void refreshAppStatus(db);
}

/* ------------------------------------------------------------- App status */

/** The client watcher's poll: refreshes if due, and says whether anything changed. */
export async function appStatusAction(): Promise<{ signature: string }> {
  return { signature: statusSignature(await refreshAppStatus(db)) };
}

/**
 * "Continue without AI" on the maintenance or update-required screen. Kept
 * against this status, so a new maintenance notice is shown again.
 */
export async function continueWithoutAiAction(screen: "maintenance" | "update"): Promise<{ ok: boolean }> {
  const status = readAppStatus(db);
  if (screen === "maintenance" && status.mode === "maintenance") {
    writeSetting(MAINTENANCE_ACK_KEY, String(status.updatedAt), db);
  } else if (screen === "update" && needsUpdate(status) && status.minVersion) {
    writeSetting(UPDATE_ACK_KEY, status.minVersion, db);
  }
  return { ok: true };
}

/** Settings → Privacy: erase this install's statistics from the server. */
export async function deleteStatisticsAction(): Promise<{ ok: boolean }> {
  return { ok: await deleteServerStatistics(db) };
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
// Short enough that an app left open all day still hears about a release
// the same afternoon; the header asks at most hourly and on focus.
const CACHE_MS = 30 * 60 * 1000;

export type UpdateInfo = { version: string; url: string; download: string | null };

type Release = { version: string; url: string; assets: { name: string; url: string }[] };

/**
 * The latest release, from the developer's server (which caches GitHub, so a
 * busy day does not run into GitHub's 60-an-hour limit), or GitHub itself when
 * that server is not set up or not answering.
 */
async function latestRelease(): Promise<Release | null> {
  const base = serverUrl();
  if (base) {
    try {
      const response = await fetch(`${base}/latest`, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const latest = (await response.json()) as Partial<Release>;
        if (latest.version) {
          return {
            version: latest.version,
            url: latest.url ?? `https://github.com/${RELEASES_REPO}/releases/latest`,
            assets: latest.assets ?? [],
          };
        }
      }
    } catch {
      // Fall through to GitHub.
    }
  }

  const response = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
    headers: { accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  const release = (await response.json()) as {
    tag_name?: string;
    html_url?: string;
    assets?: { name: string; browser_download_url: string }[];
  };
  const version = release.tag_name?.replace(/^v/, "") ?? "";
  if (!version) return null;
  return {
    version,
    url: release.html_url ?? `https://github.com/${RELEASES_REPO}/releases/latest`,
    assets: (release.assets ?? []).map((asset) => ({ name: asset.name, url: asset.browser_download_url })),
  };
}

/** The download for this computer: its own processor's build first. */
function pickDownload(
  assets: { name: string; url: string }[],
  platform: string = process.platform,
  arch: string = process.arch,
): string | null {
  const extension = platform === "win32" ? ".exe" : ".dmg";
  // On Windows the installer, not the portable exe.
  const fits = assets
    .filter((asset) => asset.name.endsWith(extension))
    .sort((a, b) => Number(b.name.includes("Setup")) - Number(a.name.includes("Setup")));
  const own = fits.find((asset) => asset.name.includes(arch));
  // A build named for no processor is universal; one named for another is not.
  const plain = fits.find((asset) => !/(arm64|x64)/.test(asset.name));
  return (own ?? plain ?? fits[0])?.url ?? null;
}

/** A newer release, if there is one. Quiet when offline. */
export async function checkForUpdateAction(): Promise<UpdateInfo | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.result;

  let result: UpdateInfo | null = null;
  try {
    const release = await latestRelease();
    if (release && compareVersions(release.version, APP_VERSION) > 0) {
      result = { version: release.version, url: release.url, download: pickDownload(release.assets) };
    }
  } catch {
    // Offline or rate-limited: say nothing rather than something wrong.
    return null;
  }

  cached = { at: Date.now(), result };
  return result;
}
