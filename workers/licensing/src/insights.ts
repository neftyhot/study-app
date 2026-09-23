/**
 * Usage reports from opted-in installs, and the developer's view of them.
 *
 *   POST /telemetry          An install's running totals (see the app's
 *                            src/lib/telemetry.ts). Only sent when the student
 *                            has ticked "Share usage statistics".
 *   GET  /admin/stats        Everything summed across installs.
 *   GET  /admin/feedback     Every feature suggestion, oldest first.
 *   DELETE /admin/feedback/… One suggestion, by key.
 *
 * Each install keeps ONE record, `telemetry:<installId>`, replaced with every
 * report. Reports carry totals since install, never increments, so a report
 * sent twice or lost changes nothing, and summing the latest record per
 * install is the whole of the aggregation.
 *
 * The admin routes need `Authorization: Bearer <ADMIN_TOKEN>`, a Worker
 * secret held otherwise only by the License Manager on the developer's Mac.
 */

export type ListResult = {
  keys: { name: string }[];
  list_complete: boolean;
  cursor?: string;
};

export type InsightsKV = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<ListResult>;
};

export type InsightsEnv = { ADMIN_TOKEN?: string; LICENSES: InsightsKV };

const INSTALL_ID = /^[a-f0-9-]{16,64}$/i;

export type UsageLine = {
  feature: string;
  provider: string;
  model: string;
  authMode: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type TelemetryRecord = {
  installId: string;
  version: string;
  platform: string;
  focusedSeconds: number;
  backgroundSeconds: number;
  subjects: number;
  decks: number;
  cards: number;
  reviewed: number;
  usage: UsageLine[];
  firstSeen: string;
  lastSeen: string;
};

function num(value: unknown, max = 1e12): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : 0;
}

function str(value: unknown, max: number, fallback = "unknown"): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

export async function handleTelemetry(request: Request, env: InsightsEnv): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse((await request.text()).slice(0, 100_000));
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  const installId = typeof body.installId === "string" ? body.installId : "";
  if (!INSTALL_ID.test(installId)) return new Response("Bad install id", { status: 400 });

  const key = `telemetry:${installId}`;
  const previous = await env.LICENSES.get(key);
  const now = new Date().toISOString();

  const usage = (Array.isArray(body.usage) ? body.usage : []).slice(0, 200).map((line) => {
    const entry = (line ?? {}) as Record<string, unknown>;
    return {
      feature: str(entry.feature, 40),
      provider: str(entry.provider, 40),
      model: str(entry.model, 80),
      authMode: str(entry.authMode, 20),
      calls: num(entry.calls),
      inputTokens: num(entry.inputTokens),
      outputTokens: num(entry.outputTokens),
      costUsd: num(entry.costUsd, 1e7),
    };
  });

  const record: TelemetryRecord = {
    installId,
    version: str(body.version, 40),
    platform: str(body.platform, 40),
    focusedSeconds: num(body.focusedSeconds),
    backgroundSeconds: num(body.backgroundSeconds),
    subjects: num(body.subjects),
    decks: num(body.decks),
    cards: num(body.cards),
    reviewed: num(body.reviewed),
    usage,
    firstSeen: previous ? (JSON.parse(previous) as TelemetryRecord).firstSeen ?? now : now,
    lastSeen: now,
  };

  await env.LICENSES.put(key, JSON.stringify(record));
  return Response.json({ ok: true });
}

/* ------------------------------------------------------------------ Admin */

function authorized(request: Request, env: InsightsEnv): boolean {
  const expected = env.ADMIN_TOKEN ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (expected.length < 16 || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

async function listAll(kv: InsightsKV, prefix: string): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, cursor });
    names.push(...page.keys.map((entry) => entry.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return names;
}

async function readAll<T>(kv: InsightsKV, prefix: string): Promise<{ key: string; value: T }[]> {
  const keys = (await listAll(kv, prefix)).sort();
  const values = await Promise.all(keys.map((key) => kv.get(key)));
  return keys.flatMap((key, i) => {
    try {
      return values[i] ? [{ key, value: JSON.parse(values[i]!) as T }] : [];
    } catch {
      return [];
    }
  });
}

export type Aggregate = ReturnType<typeof aggregate>;

/** Everything the developer sees, summed from the latest record per install. */
export function aggregate(records: TelemetryRecord[], now = Date.now()) {
  const days = (iso: string) => (now - Date.parse(iso)) / 86_400_000;

  const versions = new Map<string, number>();
  const byFeature = new Map<string, { calls: number; inputTokens: number; outputTokens: number; costUsd: number }>();
  const byModel = new Map<string, { calls: number; inputTokens: number; outputTokens: number; costUsd: number }>();
  const byAuth = new Map<string, number>();

  const add = (map: typeof byFeature, key: string, line: UsageLine) => {
    const entry = map.get(key) ?? { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    entry.calls += line.calls;
    entry.inputTokens += line.inputTokens;
    entry.outputTokens += line.outputTokens;
    entry.costUsd += line.costUsd;
    map.set(key, entry);
  };

  const totals = {
    focusedSeconds: 0,
    backgroundSeconds: 0,
    subjects: 0,
    decks: 0,
    cards: 0,
    reviewed: 0,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };

  for (const record of records) {
    versions.set(record.version, (versions.get(record.version) ?? 0) + 1);
    totals.focusedSeconds += record.focusedSeconds;
    totals.backgroundSeconds += record.backgroundSeconds;
    totals.subjects += record.subjects;
    totals.decks += record.decks;
    totals.cards += record.cards;
    totals.reviewed += record.reviewed;
    for (const line of record.usage) {
      totals.calls += line.calls;
      totals.inputTokens += line.inputTokens;
      totals.outputTokens += line.outputTokens;
      totals.costUsd += line.costUsd;
      add(byFeature, line.feature, line);
      add(byModel, `${line.provider} · ${line.model}`, line);
      byAuth.set(line.authMode, (byAuth.get(line.authMode) ?? 0) + line.calls);
    }
  }

  const sorted = <T,>(map: Map<string, T>, by: (value: T) => number) =>
    [...map.entries()].map(([name, value]) => ({ name, ...value })).sort((a, b) => by(b as T) - by(a as T));

  const installs = records.length;
  return {
    installs,
    active7: records.filter((r) => days(r.lastSeen) <= 7).length,
    active30: records.filter((r) => days(r.lastSeen) <= 30).length,
    new7: records.filter((r) => days(r.firstSeen) <= 7).length,
    totals,
    versions: [...versions.entries()]
      .map(([version, count]) => ({ version, count, percent: installs ? Math.round((count / installs) * 1000) / 10 : 0 }))
      .sort((a, b) => b.count - a.count),
    byFeature: sorted(byFeature, (v) => v.inputTokens + v.outputTokens),
    byModel: sorted(byModel, (v) => v.inputTokens + v.outputTokens),
    byAuth: [...byAuth.entries()].map(([name, calls]) => ({ name, calls })).sort((a, b) => b.calls - a.calls),
  };
}

export async function handleAdmin(request: Request, env: InsightsEnv, path: string): Promise<Response> {
  if (!authorized(request, env)) return new Response("Unauthorized", { status: 401 });

  if (request.method === "GET" && path === "/admin/stats") {
    const records = await readAll<TelemetryRecord>(env.LICENSES, "telemetry:");
    const feedback = await listAll(env.LICENSES, "feedback:");
    return Response.json({ ...aggregate(records.map((r) => r.value)), suggestions: feedback.length });
  }

  if (request.method === "GET" && path === "/admin/feedback") {
    const entries = await readAll<Record<string, unknown>>(env.LICENSES, "feedback:");
    return Response.json(entries.map(({ key, value }) => ({ key, ...value })));
  }

  if (request.method === "DELETE" && path.startsWith("/admin/feedback/")) {
    const key = decodeURIComponent(path.slice("/admin/feedback/".length));
    if (!key.startsWith("feedback:")) return new Response("Bad key", { status: 400 });
    await env.LICENSES.delete(key);
    return Response.json({ ok: true });
  }

  return new Response("Not found", { status: 404 });
}
