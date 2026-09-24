/**
 * The usage report every install sends to the developer.
 *
 * Sending is a condition of use (see src/lib/privacy-policy.ts), so it starts
 * the moment the policy is agreed to and says only what the policy promises:
 * counts, token totals and time — never a file, card, question or answer. Totals since install, so a lost or repeated
 * report changes nothing (see workers/licensing/src/insights.ts). The
 * install is identified by a random id made here, not the machine id the
 * licence uses.
 */
import { count, sql } from "drizzle-orm";

import type { Db } from "@/db/client";
import { usageEvents } from "@/db/schema";
import { APP_VERSION, serverUrl } from "@/lib/app-info";
import { readSetting, writeSetting } from "@/lib/settings";
import { loadStats } from "@/lib/stats";
import { isUsageLoggingEnabled } from "@/lib/usage";

const INSTALL_ID_KEY = "install_id";
const LAST_SENT_KEY = "telemetry_last_sent";
const LAST_COUNTS_KEY = "telemetry_last_counts";
/** The regular heartbeat while the app is open. */
export const REPORT_EVERY_MS = 15 * 60 * 1000;
/** A change in subjects, decks or cards is reported sooner, but no more often than this. */
export const CHANGE_MIN_GAP_MS = 60 * 1000;

export function installId(db: Db): string {
  const existing = readSetting(INSTALL_ID_KEY, db);
  if (existing) return existing;
  const id = crypto.randomUUID();
  writeSetting(INSTALL_ID_KEY, id, db);
  return id;
}

export function buildReport(db: Db) {
  const stats = loadStats(db);

  const usage = db
    .select({
      feature: usageEvents.feature,
      provider: usageEvents.provider,
      model: usageEvents.model,
      authMode: usageEvents.authMode,
      calls: count(),
      inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`,
      costUsd: sql<number>`coalesce(sum(${usageEvents.estimatedCostUsd}), 0)`,
    })
    .from(usageEvents)
    .groupBy(usageEvents.feature, usageEvents.provider, usageEvents.model, usageEvents.authMode)
    .all();

  return {
    installId: installId(db),
    version: APP_VERSION,
    platform: `${process.platform}-${process.arch}`,
    focusedSeconds: stats.focusedSeconds,
    backgroundSeconds: stats.backgroundSeconds,
    subjects: stats.subjects,
    decks: stats.decks,
    cards: stats.cards,
    reviewed: stats.reviewed,
    usage,
  };
}

/** What the dashboard's headline tiles show; a change here is worth sending soon. */
function countsKey(report: ReturnType<typeof buildReport>): string {
  return `${report.subjects}/${report.decks}/${report.cards}`;
}

/**
 * Whether a report is due: every 15 minutes, or a minute after the number of
 * subjects, decks or cards last sent has changed.
 */
export function isReportDue(
  lastSentIso: string | null,
  lastCounts: string | null,
  counts: string,
  now = Date.now(),
): boolean {
  const last = Date.parse(lastSentIso ?? "");
  if (!Number.isFinite(last)) return true;
  const since = now - last;
  if (since >= REPORT_EVERY_MS) return true;
  return counts !== lastCounts && since >= CHANGE_MIN_GAP_MS;
}

/**
 * Sends a report once the privacy policy is agreed to and one is due. Never
 * throws, and never holds anything up: a report that fails just goes next time.
 */
export async function maybeSendReport(db: Db, { force = false } = {}): Promise<boolean> {
  try {
    if (!isUsageLoggingEnabled(db)) return false;
    const base = serverUrl();
    if (!base) return false;

    const report = buildReport(db);
    const counts = countsKey(report);
    if (
      !force &&
      !isReportDue(readSetting(LAST_SENT_KEY, db), readSetting(LAST_COUNTS_KEY, db), counts)
    ) {
      return false;
    }

    const response = await fetch(`${base}/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;

    writeSetting(LAST_SENT_KEY, new Date().toISOString(), db);
    writeSetting(LAST_COUNTS_KEY, counts, db);
    return true;
  } catch {
    return false;
  }
}
