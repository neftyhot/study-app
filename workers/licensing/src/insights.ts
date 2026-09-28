/**
 * Usage reports from every install, and the developer's view of them.
 *
 *   POST /telemetry          An install's running totals (see the app's
 *                            src/lib/telemetry.ts). Required by the app's privacy
 *                            policy; sent about hourly and on count changes.
 *   DELETE /telemetry/:id    Forget an install (the app's Settings, for GDPR
 *                            erasure). Succeeds whether or not it existed.
 *   GET  /admin/stats        Everything summed across installs; cached ~10 min
 *                            in `stats:cache`, `?fresh=1` recomputes.
 *   GET  /config             Remote defaults (which AI models to use), so a
 *                            retired model is swapped without a release.
 *   PUT  /admin/config       Sets them; see sanitizeConfig.
 *   GET  /admin/feedback     Every feature suggestion, oldest first.
 *   DELETE /admin/feedback/… One suggestion, by key.
 *
 * Each install keeps ONE record, `telemetry:<installId>`, replaced with every
 * report. Reports carry totals since install, never increments, so a report
 * sent twice or lost changes nothing, and summing the latest record per
 * install is the whole of the aggregation.
 *
 * A report that changes nothing is not written: KV bills and rate-limits
 * writes, and an unchanged record only moves `lastSeen`, which is kept to
 * within the hour (see shouldWrite).
 *
 * The admin routes need `Authorization: Bearer <ADMIN_TOKEN>`, a Worker
 * secret held otherwise only by the License Manager on the developer's Mac.
 * While it is being rotated, `ADMIN_TOKEN_NEXT` is accepted too.
 */

export type ListResult = {
  /** `metadata` is what was put with the key, when anything was. */
  keys: { name: string; metadata?: unknown }[];
  list_complete: boolean;
  cursor?: string;
};

export type InsightsKV = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: PutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<ListResult>;
};

/** The part of Cloudflare's KV put options used here. Metadata is ≤ 1024 bytes as JSON. */
export type PutOptions = { metadata?: unknown; expirationTtl?: number };

export type InsightsEnv = { ADMIN_TOKEN?: string; ADMIN_TOKEN_NEXT?: string; LICENSES: InsightsKV };

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

const MINUTE = 60_000;
/** An unchanged install is rewritten at most this often, so `lastSeen` stays within the hour. */
const UNCHANGED_WRITE_MS = 50 * MINUTE;
/** A changing install (mid-study, adding cards) is rewritten at most this often. */
const CHANGED_WRITE_MS = 10 * MINUTE;

/**
 * Whether a report is worth a KV write. Totals only grow, so a skipped report
 * loses nothing the next written one does not carry.
 */
export function shouldWrite(previous: TelemetryRecord | null, next: TelemetryRecord, now = Date.now()): boolean {
  // New, or just updated: the version breakdown should show it at once.
  if (!previous || previous.version !== next.version) return true;
  const age = now - Date.parse(previous.lastSeen);
  if (!Number.isFinite(age)) return true;
  const same =
    previous.subjects === next.subjects &&
    previous.decks === next.decks &&
    previous.cards === next.cards &&
    previous.reviewed === next.reviewed;
  return age >= (same ? UNCHANGED_WRITE_MS : CHANGED_WRITE_MS);
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
  let previous: TelemetryRecord | null = null;
  try {
    const raw = await env.LICENSES.get(key);
    previous = raw ? (JSON.parse(raw) as TelemetryRecord) : null;
  } catch {
    previous = null;
  }
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
    firstSeen: previous?.firstSeen ?? now,
    lastSeen: now,
  };

  if (shouldWrite(previous, record)) await env.LICENSES.put(key, JSON.stringify(record));
  return Response.json({ ok: true });
}

/** GDPR erasure from the app's Settings: the install's one record, gone. */
export async function handleTelemetryDelete(installId: string, env: InsightsEnv): Promise<Response> {
  if (!INSTALL_ID.test(installId)) return new Response("Bad install id", { status: 400 });
  await env.LICENSES.delete(`telemetry:${installId}`);
  // Or the cached totals would still count it for up to ten minutes.
  await env.LICENSES.delete(STATS_CACHE_KEY);
  return Response.json({ ok: true });
}

/* ------------------------------------------------------------------ Admin */

/**
 * The current token or, while rotating, the next one. Both are compared in
 * full, so which one matched (or how nearly) takes the same time.
 */
export function authorized(request: Request, env: InsightsEnv): boolean {
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const current = tokenMatches(env.ADMIN_TOKEN, given);
  const next = tokenMatches(env.ADMIN_TOKEN_NEXT, given);
  return current || next;
}

function tokenMatches(expected: string | undefined, given: string): boolean {
  if (!expected || expected.length < 16 || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

export async function listEntries(kv: InsightsKV, prefix: string): Promise<{ name: string; metadata?: unknown }[]> {
  const entries: { name: string; metadata?: unknown }[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, cursor });
    entries.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return entries;
}

export async function listAll(kv: InsightsKV, prefix: string): Promise<string[]> {
  return (await listEntries(kv, prefix)).map((entry) => entry.name);
}

/** Reads per batch: enough to be quick, few enough not to trip the Worker's subrequest limits. */
const READ_CONCURRENCY = 50;

async function getMany(kv: InsightsKV, keys: string[]): Promise<(string | null)[]> {
  const values: (string | null)[] = [];
  for (let i = 0; i < keys.length; i += READ_CONCURRENCY) {
    values.push(...(await Promise.all(keys.slice(i, i + READ_CONCURRENCY).map((key) => kv.get(key)))));
  }
  return values;
}

async function readAll<T>(kv: InsightsKV, prefix: string): Promise<{ key: string; value: T }[]> {
  const keys = (await listAll(kv, prefix)).sort();
  const values = await getMany(kv, keys);
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
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    if (!fresh) {
      const cached = await readCache(env.LICENSES, STATS_CACHE_KEY);
      if (cached && Date.now() - cached.at < STATS_CACHE_MS) return Response.json(cached.value);
    }
    const records = await readAll<TelemetryRecord>(env.LICENSES, "telemetry:");
    const feedback = await listAll(env.LICENSES, "feedback:");
    const value = { ...aggregate(records.map((r) => r.value)), suggestions: feedback.length };
    await env.LICENSES.put(STATS_CACHE_KEY, JSON.stringify({ at: Date.now(), value }));
    return Response.json(value);
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

  // Keys minted here from Stripe checkouts. The License Manager never signed
  // them, so without this they are missing from its ledger and cannot be
  // revoked there.
  //
  // Purchases since metadata was added carry everything in the listing
  // (see purchaseMetadata); older ones, and any whose key was too long for
  // metadata, are read one by one.
  if (request.method === "GET" && path === "/admin/purchases") {
    const listed = (await listEntries(env.LICENSES, "session:")).sort((a, b) => (a.name < b.name ? -1 : 1));
    const fromMetadata = listed.map((entry) => asPurchase(entry.metadata));
    const missing = listed.filter((_, i) => !fromMetadata[i]).map((entry) => entry.name);
    const fetched = new Map<string, Purchase | null>();
    const raw = await getMany(env.LICENSES, missing);
    missing.forEach((name, i) => {
      try {
        fetched.set(name, raw[i] ? asPurchase(JSON.parse(raw[i]!)) : null);
      } catch {
        fetched.set(name, null);
      }
    });
    const auto = await autoRevokedIds(env);
    return Response.json(
      listed
        .map((entry, i) => fromMetadata[i] ?? fetched.get(entry.name) ?? null)
        .filter((purchase): purchase is Purchase => purchase !== null)
        .map((purchase) => ({ ...purchase, revoked: purchase.licenseId ? auto.has(purchase.licenseId) : false })),
    );
  }

  if (request.method === "PUT" && path === "/admin/config") {
    let body: unknown;
    try {
      body = JSON.parse((await request.text()).slice(0, 20_000));
    } catch {
      return new Response("Bad payload", { status: 400 });
    }
    const config = sanitizeConfig(body);
    await env.LICENSES.put(CONFIG_KEY, JSON.stringify(config));
    return Response.json(config);
  }

  if (request.method === "PUT" && path === "/admin/revocations") {
    let body: { ids?: unknown };
    try {
      body = JSON.parse((await request.text()).slice(0, 200_000));
    } catch {
      return new Response("Bad payload", { status: 400 });
    }
    if (!Array.isArray(body.ids)) return new Response("Bad payload", { status: 400 });
    const ids = [...new Set(body.ids.filter((id): id is string => typeof id === "string" && LICENSE_ID.test(id)))];
    await env.LICENSES.put(REVOKED_KEY, JSON.stringify(ids));
    return Response.json({ ok: true, revoked: ids.length });
  }

  return new Response("Not found", { status: 404 });
}

const STATS_CACHE_KEY = "stats:cache";
const STATS_CACHE_MS = 10 * MINUTE;

/** A `{ at, value }` cache entry, or null when absent or unreadable. */
export async function readCache<T = unknown>(kv: InsightsKV, key: string): Promise<{ at: number; value: T } | null> {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { at?: unknown; value?: T };
    return typeof parsed.at === "number" && parsed.value !== undefined ? { at: parsed.at, value: parsed.value } : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------- Remote config */

const CONFIG_KEY = "config";
const CONFIG_MODELS = ["gemini", "geminiBulk", "geminiPrimer", "anthropic", "openai"] as const;
const MODEL_ID = /^[A-Za-z0-9._:\/-]{1,80}$/;

export type RemoteConfig = { models?: Partial<Record<(typeof CONFIG_MODELS)[number], string>> };

/** Keeps only known model slots holding a plausible model id; everything else is dropped. */
export function sanitizeConfig(body: unknown): RemoteConfig {
  const models = (body as { models?: unknown } | null)?.models;
  if (!models || typeof models !== "object") return {};
  const kept: RemoteConfig["models"] = {};
  for (const slot of CONFIG_MODELS) {
    const value = (models as Record<string, unknown>)[slot];
    if (typeof value === "string" && MODEL_ID.test(value)) kept[slot] = value;
  }
  return { models: kept };
}

/** Public: every install reads it, so browsers and Cloudflare may cache it for ten minutes. */
export async function handleConfig(env: InsightsEnv): Promise<Response> {
  let config: unknown = {};
  try {
    config = JSON.parse((await env.LICENSES.get(CONFIG_KEY)) ?? "{}");
  } catch {
    config = {};
  }
  return Response.json(config, { headers: { "Cache-Control": "public, max-age=600" } });
}

/* ------------------------------------------------------------- Purchases */

export type Purchase = { token: string; licenseId: string | null; email: string | null; issuedAt: number | null };

/** KV's limit on a key's metadata, as JSON. */
const METADATA_MAX_BYTES = 1024;

/**
 * What goes beside `session:<id>` so /admin/purchases needs no read per key.
 * A key is a few hundred bytes, but a long buyer name or machine id can push
 * it past KV's metadata limit; then the token is left out and read instead.
 */
export function purchaseMetadata(purchase: Purchase): Record<string, unknown> {
  const full = { token: purchase.token, licenseId: purchase.licenseId, email: purchase.email, issuedAt: purchase.issuedAt };
  if (new TextEncoder().encode(JSON.stringify(full)).length <= METADATA_MAX_BYTES) return full;
  // Without its token the entry is read in full anyway; the id still lets
  // /admin/reissue find the purchase from the listing.
  return { licenseId: purchase.licenseId, issuedAt: purchase.issuedAt };
}

function asPurchase(value: unknown): Purchase | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.token !== "string") return null;
  return {
    token: record.token,
    licenseId: typeof record.licenseId === "string" ? record.licenseId : null,
    email: typeof record.email === "string" ? record.email : null,
    issuedAt: typeof record.issuedAt === "number" ? record.issuedAt : null,
  };
}

/* ------------------------------------------------------------ Revocation */

/**
 * The License Manager keeps the ledger of every key it has issued; revoking
 * one there sends the whole list of revoked ids here (replacing the last), so
 * restoring a key is the same call with that id left out. The app asks about
 * its own key by id, and never sees the list.
 */
const REVOKED_KEY = "revoked";
export const LICENSE_ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Revocations the Worker makes itself — a refund, a dispute, a reissued key —
 * kept apart from the License Manager's list, because its PUT replaces
 * `revoked` wholesale from its own ledger and would quietly restore them.
 */
const AUTO_REVOKED_KEY = "revoked:auto";

async function readIds(env: InsightsEnv, key: string): Promise<Set<string>> {
  const raw = await env.LICENSES.get(key);
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export async function revokedIds(env: InsightsEnv): Promise<Set<string>> {
  return readIds(env, REVOKED_KEY);
}

export async function autoRevokedIds(env: InsightsEnv): Promise<Set<string>> {
  return readIds(env, AUTO_REVOKED_KEY);
}

/** Adds one id to the Worker's own list; adding it twice is harmless. */
export async function revokeAutomatically(env: InsightsEnv, id: string): Promise<void> {
  const ids = await autoRevokedIds(env);
  if (ids.has(id)) return;
  ids.add(id);
  await env.LICENSES.put(AUTO_REVOKED_KEY, JSON.stringify([...ids]));
}

export async function isRevoked(env: InsightsEnv, id: string): Promise<boolean> {
  const [manual, auto] = await Promise.all([revokedIds(env), autoRevokedIds(env)]);
  return manual.has(id) || auto.has(id);
}
