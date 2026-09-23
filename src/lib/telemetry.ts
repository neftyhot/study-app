/**
 * The usage report an opted-in install sends to the developer.
 *
 * Only ever sent when "Share usage statistics" is ticked, and it says only
 * what that setting promises: counts, token totals and time — never a file,
 * card, question or answer. Totals since install, so a lost or repeated
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
export const REPORT_EVERY_MS = 6 * 60 * 60 * 1000;

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

/**
 * Sends a report if the student opted in and one is due. Never throws, and
 * never holds anything up: a report that fails just goes next time.
 */
export async function maybeSendReport(db: Db, { force = false } = {}): Promise<boolean> {
  try {
    if (!isUsageLoggingEnabled(db)) return false;
    const base = serverUrl();
    if (!base) return false;

    const last = Date.parse(readSetting(LAST_SENT_KEY, db) ?? "");
    if (!force && Number.isFinite(last) && Date.now() - last < REPORT_EVERY_MS) return false;

    const response = await fetch(`${base}/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildReport(db)),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;

    writeSetting(LAST_SENT_KEY, new Date().toISOString(), db);
    return true;
  } catch {
    return false;
  }
}
