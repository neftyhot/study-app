/**
 * The licensing Worker: turns a Stripe payment into a Megan Study license.
 *
 *   POST /stripe/webhook   Stripe → here. On a paid checkout, mint a
 *                          `lifetime` key for the machine id Stripe carried
 *                          back as `client_reference_id`, and keep it. On a
 *                          full refund or a dispute, revoke that key.
 *   GET  /license/:machine The app polls this after opening checkout, and
 *                          activates with whatever it gets — after verifying
 *                          the signature itself, like any pasted key.
 *   GET  /success          Where the Payment Link redirects after paying:
 *                          shows the key, as a fallback to automatic delivery.
 *   POST /telemetry, /admin/*  Usage totals (every install) and the developer's
 *                          view of them and of suggestions (insights.ts).
 *   DELETE /telemetry/:id  Erase one install's usage record.
 *   POST /admin/reissue    Move a purchase to a new machine: a fresh key for
 *                          it, and the old one revoked.
 *   GET  /latest           The newest GitHub release, cached ~10 min.
 *   GET  /config           Remote model defaults (PUT /admin/config sets them).
 *   GET  /status           Maintenance mode, AI pause, feature switches and
 *                          minimum version (PUT /admin/status sets them;
 *                          status.ts).
 *   GET  /revoked/:id      Whether a key has been revoked in the License
 *                          Manager (PUT /admin/revocations sets the list).
 *   /catalog, /catalog/:id The shared deck catalog, in D1, with every new
 *                          deck checked by Gemini first (catalog.ts).
 *   POST /feedback         A feature suggestion from the app's settings.
 *                          Stored under `feedback:`; read in the License
 *                          Manager's Suggestions tab.
 *
 * The key is minted in exactly the format scripts/license-store.mjs produces
 * and electron/license/verify.cjs accepts: base64 of { payload, signature },
 * Ed25519 over the payload bytes as they travel.
 *
 * No dependencies. Stripe's signature check is an HMAC and the license is an
 * Ed25519 signature, and Web Crypto does both — in a Worker and in Node, so
 * the tests run this same file.
 */

import {
  authorized,
  handleAdmin,
  handleConfig,
  handleTelemetry,
  handleTelemetryDelete,
  isRevoked,
  LICENSE_ID,
  listEntries,
  purchaseMetadata,
  readCache,
  revokeAutomatically,
  type ListResult,
  type PutOptions,
} from "./insights";
import { handleCatalog, type D1Like } from "./catalog";
import { handleStatus, handleStatusUpdate } from "./status";

export type KVLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: PutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<ListResult>;
};

export type Env = {
  /** `whsec_…`, from the webhook endpoint in the Stripe dashboard. */
  STRIPE_WEBHOOK_SECRET: string;
  /** The Ed25519 signing key, PKCS#8 PEM: the contents of .license-private-key.pem. */
  LICENSE_PRIVATE_KEY: string;
  /** When set, only checkouts from this Payment Link (plink_…) mint a key. */
  PAYMENT_LINK_ID?: string;
  /** Bearer token for the /admin routes; held by the License Manager. */
  ADMIN_TOKEN?: string;
  /** The replacement token while ADMIN_TOKEN is being rotated (README). */
  ADMIN_TOKEN_NEXT?: string;
  LICENSES: KVLike;
  /** The deck catalog's D1 database (migrations/). */
  CATALOG?: D1Like;
  /** The developer's Gemini key: moderates catalog shares. Unset, sharing is off. */
  GEMINI_API_KEY?: string;
  /** Overrides the catalog's moderation model. */
  GEMINI_MODERATION_MODEL?: string;
};

/** How stale a webhook may be before it is treated as a replay (Stripe's default). */
const SIGNATURE_TOLERANCE_S = 300;

/** Stripe's own limit for client_reference_id, and what a machine id looks like. */
const MACHINE_ID = /^[A-Za-z0-9_-]{1,200}$/;
const SESSION_ID = /^cs_[A-Za-z0-9_]{1,250}$/;

export type IssuedLicense = {
  token: string;
  licenseId: string;
  machineId: string;
  sessionId: string;
  email: string | null;
  issuedAt: number;
};

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/stripe/webhook") {
      return handleWebhook(request, env);
    }

    if (request.method === "GET" && url.pathname.startsWith("/license/")) {
      return handleLicenseLookup(
        decodeURIComponent(url.pathname.slice("/license/".length)),
        env,
      );
    }

    if (request.method === "GET" && url.pathname.startsWith("/revoked/")) {
      const id = decodeURIComponent(url.pathname.slice("/revoked/".length));
      if (!LICENSE_ID.test(id)) return new Response("Bad license id", { status: 400 });
      return json({ revoked: await isRevoked(env, id) });
    }

    if (request.method === "POST" && url.pathname === "/telemetry") {
      return handleTelemetry(request, env);
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/telemetry/")) {
      return handleTelemetryDelete(decodeURIComponent(url.pathname.slice("/telemetry/".length)), env);
    }

    if (request.method === "GET" && url.pathname === "/config") {
      return handleConfig(env);
    }

    if (request.method === "GET" && url.pathname === "/status") {
      return handleStatus(env);
    }

    if (request.method === "PUT" && url.pathname === "/admin/status") {
      if (!authorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return handleStatusUpdate(request, env);
    }

    if (request.method === "GET" && url.pathname === "/latest") {
      return handleLatest(env);
    }

    if (request.method === "POST" && url.pathname === "/admin/reissue") {
      if (!authorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return handleReissue(request, env);
    }

    const catalog = await handleCatalog(request, env, url);
    if (catalog) return catalog;

    if (url.pathname.startsWith("/admin/")) {
      return handleAdmin(request, env, url.pathname);
    }

    if (request.method === "POST" && url.pathname === "/feedback") {
      return handleFeedback(request, env);
    }

    if (request.method === "GET" && url.pathname === "/success") {
      return handleSuccess(url.searchParams.get("session_id") ?? "", env);
    }

    return new Response("Not found", { status: 404 });
  },
};

export default worker;

/* --------------------------------------------------------------- Feedback */

export const FEEDBACK_MAX_CHARS = 5000;

export type Feedback = {
  text: string;
  contact: string | null;
  version: string | null;
  receivedAt: string;
};

/**
 * Keeps a suggestion. Anyone can post one — it is a suggestion box — so the
 * only defences are size limits; nothing here is ever executed or shown to
 * another user.
 */
async function handleFeedback(request: Request, env: Env): Promise<Response> {
  let body: { text?: unknown; contact?: unknown; version?: unknown };
  try {
    body = JSON.parse((await request.text()).slice(0, 20_000));
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return new Response("Empty suggestion", { status: 400 });
  const short = (value: unknown, max: number) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

  const entry: Feedback = {
    text: text.slice(0, FEEDBACK_MAX_CHARS),
    contact: short(body.contact, 200),
    version: short(body.version, 40),
    receivedAt: new Date().toISOString(),
  };

  // Time first, so a key listing comes back in the order they arrived.
  await env.LICENSES.put(`feedback:${entry.receivedAt}:${crypto.randomUUID()}`, JSON.stringify(entry));
  return Response.json({ ok: true }, { status: 201 });
}

/* ---------------------------------------------------------------- Webhook */

type CheckoutSession = {
  id: string;
  client_reference_id?: string | null;
  payment_intent?: string | null;
  payment_status?: string;
  payment_link?: string | null;
  customer_details?: { email?: string | null; name?: string | null } | null;
};

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  // The raw body, exactly as sent: the signature is over these bytes.
  const body = await request.text();

  const verified = await verifyStripeSignature(
    body,
    request.headers.get("stripe-signature"),
    env.STRIPE_WEBHOOK_SECRET,
  );
  if (!verified) return new Response("Bad signature", { status: 400 });

  let event: { type?: string; data?: { object?: CheckoutSession } };
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
    return handleClawback(event.type, (event.data?.object ?? {}) as Clawback, env);
  }

  // `completed` for cards; `async_payment_succeeded` for methods (bank
  // debits) whose money arrives after the checkout page has closed.
  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    return json({ received: true, ignored: event.type ?? null });
  }

  const session = event.data?.object;
  if (!session?.id) return new Response("No session", { status: 400 });

  // Not paid yet (an async method still clearing): its own event follows.
  if (session.payment_status !== "paid") {
    return json({ received: true, pending: true });
  }

  if (env.PAYMENT_LINK_ID && session.payment_link !== env.PAYMENT_LINK_ID) {
    return json({ received: true, ignored: "other payment link" });
  }

  const machineId = session.client_reference_id?.trim() ?? "";
  if (!MACHINE_ID.test(machineId)) {
    // Paid, but with no machine to bind to (the link was opened outside the
    // app). Acknowledged so Stripe stops retrying; it needs a hand-minted key.
    console.error(`[licensing] ${session.id} paid with no usable client_reference_id`);
    return json({ received: true, unbound: true });
  }

  // Stripe retries and may deliver twice; one purchase is one key.
  const existing = await env.LICENSES.get(`session:${session.id}`);
  if (existing) return json({ received: true, duplicate: true });

  const issued = await mintLifetimeLicense(env.LICENSE_PRIVATE_KEY, {
    machineId,
    sessionId: session.id,
    name: session.customer_details?.name ?? null,
    email: session.customer_details?.email ?? null,
  });

  await storePurchase(env, issued);
  // How a later refund or dispute, which names only the payment, finds the key.
  if (session.payment_intent) {
    await env.LICENSES.put(`pi:${session.payment_intent}`, session.id);
  }

  return json({ received: true, licenseId: issued.licenseId });
}

async function storePurchase(env: Env, issued: IssuedLicense): Promise<void> {
  const record = JSON.stringify(issued);
  await env.LICENSES.put(`session:${issued.sessionId}`, record, { metadata: purchaseMetadata(issued) });
  await env.LICENSES.put(`machine:${issued.machineId}`, record);
}

/** A charge (on `charge.refunded`) or a dispute: both name the payment intent. */
type Clawback = {
  payment_intent?: string | null;
  amount?: number;
  amount_refunded?: number;
  refunded?: boolean;
};

/**
 * Money back means the key goes: a full refund, or any dispute (the money is
 * held from the moment it opens). A partial refund — a goodwill discount —
 * keeps it. Payments this Worker never minted for are acknowledged and left.
 */
async function handleClawback(type: string, object: Clawback, env: Env): Promise<Response> {
  if (type === "charge.refunded") {
    const full =
      object.refunded === true ||
      (typeof object.amount === "number" &&
        typeof object.amount_refunded === "number" &&
        object.amount_refunded >= object.amount);
    if (!full) return json({ received: true, partial: true });
  }

  const sessionId = object.payment_intent ? await env.LICENSES.get(`pi:${object.payment_intent}`) : null;
  const record = sessionId ? await env.LICENSES.get(`session:${sessionId}`) : null;
  if (!record) return json({ received: true, unknown: true });

  const { licenseId } = JSON.parse(record) as IssuedLicense;
  await revokeAutomatically(env, licenseId);
  return json({ received: true, revoked: licenseId });
}

/**
 * Stripe's webhook signature: `t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`.
 * Any `v1` may match (there are two while a secret is being rolled).
 */
export async function verifyStripeSignature(
  body: string,
  header: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!header || !secret) return false;

  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }

  if (timestamp === null || !Number.isFinite(timestamp) || signatures.length === 0) {
    return false;
  }
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_S) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = toHex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${body}`),
    ),
  );

  return signatures.some((signature) => constantTimeEqual(signature, expected));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

/* ---------------------------------------------------------------- Minting */

/**
 * A `lifetime` key: never expires, opens only on `machineId`.
 *
 * `name` shows in the app's Settings as "Issued to …". The email and the
 * Stripe session are kept in the store for support, not in the key.
 */
export async function mintLifetimeLicense(
  privateKeyPem: string,
  input: {
    machineId: string;
    sessionId: string;
    name: string | null;
    email: string | null;
  },
  now: number = Date.now(),
): Promise<IssuedLicense> {
  const payload: Record<string, unknown> = {
    id: crypto.randomUUID(),
    type: "lifetime",
    issuedAt: now,
    machineId: input.machineId,
  };
  const name = input.name?.trim();
  if (name) payload.name = name;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(privateKeyPem),
    { name: "Ed25519" },
    false,
    ["sign"],
  );

  // The exact bytes signed are the bytes that travel.
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", key, bytes));

  const token = toBase64(
    new TextEncoder().encode(
      JSON.stringify({ payload: toBase64(bytes), signature: toBase64(signature) }),
    ),
  );

  return {
    token,
    licenseId: payload.id as string,
    machineId: input.machineId,
    sessionId: input.sessionId,
    email: input.email,
    issuedAt: now,
  };
}

function pemToDer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return bytes.buffer;
}

/* ---------------------------------------------------------------- Reissue */

/**
 * A buyer on a new computer: their key is bound to the old one, so they get a
 * new key for the new machine id and the old key is revoked. Found by the
 * purchase's license id or checkout session; hand-minted keys have neither
 * here and are reissued with scripts/mint-license.mjs.
 */
async function handleReissue(request: Request, env: Env): Promise<Response> {
  let body: { licenseId?: unknown; sessionId?: unknown; machineId?: unknown };
  try {
    body = JSON.parse((await request.text()).slice(0, 10_000));
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  const machineId = typeof body.machineId === "string" ? body.machineId.trim() : "";
  if (!MACHINE_ID.test(machineId)) return new Response("Bad machine id", { status: 400 });

  let sessionId: string | null = null;
  if (typeof body.sessionId === "string" && SESSION_ID.test(body.sessionId)) {
    sessionId = body.sessionId;
  } else if (typeof body.licenseId === "string" && LICENSE_ID.test(body.licenseId)) {
    sessionId = await findSessionByLicense(env, body.licenseId);
  } else {
    return new Response("Need licenseId or sessionId", { status: 400 });
  }

  const raw = sessionId ? await env.LICENSES.get(`session:${sessionId}`) : null;
  if (!raw) return new Response("No such purchase", { status: 404 });
  const old = JSON.parse(raw) as IssuedLicense;

  const issued = await mintLifetimeLicense(env.LICENSE_PRIVATE_KEY, {
    machineId,
    sessionId: old.sessionId,
    name: nameInToken(old.token),
    email: old.email,
  });

  await storePurchase(env, issued);
  // The old machine's poll would otherwise keep answering with a dead key.
  if (old.machineId !== machineId) await env.LICENSES.delete(`machine:${old.machineId}`);
  await revokeAutomatically(env, old.licenseId);

  return json({ token: issued.token, licenseId: issued.licenseId, revoked: old.licenseId });
}

async function findSessionByLicense(env: Env, licenseId: string): Promise<string | null> {
  const entries = await listEntries(env.LICENSES, "session:");
  for (const entry of entries) {
    const metadata = entry.metadata as { licenseId?: unknown } | undefined;
    if (metadata && typeof metadata.licenseId === "string") {
      if (metadata.licenseId === licenseId) return entry.name.slice("session:".length);
      continue;
    }
    // Written before metadata: read it.
    const raw = await env.LICENSES.get(entry.name);
    if (raw && (JSON.parse(raw) as IssuedLicense).licenseId === licenseId) {
      return entry.name.slice("session:".length);
    }
  }
  return null;
}

/** The "Issued to" name inside a key minted here, so a reissue keeps it. */
function nameInToken(token: string): string | null {
  try {
    const { payload } = JSON.parse(atob(token)) as { payload: string };
    const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
    const { name } = JSON.parse(new TextDecoder().decode(bytes)) as { name?: unknown };
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------- Latest release */

const LATEST_URL = "https://api.github.com/repos/neftyhot/study-app/releases/latest";
const LATEST_CACHE_KEY = "latest:cache";
const LATEST_CACHE_MS = 10 * 60_000;

export type LatestRelease = {
  version: string;
  tag: string;
  url: string;
  publishedAt: string | null;
  assets: { name: string; url: string }[];
};

/**
 * The app's update check. GitHub allows 60 unauthenticated calls an hour per
 * IP, which every install asking directly would soon exhaust; one cached call
 * here serves them all, and a stale answer beats none when GitHub is down.
 */
async function handleLatest(env: Env): Promise<Response> {
  const cached = await readCache<LatestRelease>(env.LICENSES, LATEST_CACHE_KEY);
  if (cached && Date.now() - cached.at < LATEST_CACHE_MS) return json(cached.value);

  const errors: string[] = [];
  // The API first; github.com's own pages when it refuses. Workers share
  // Cloudflare's IPs, which often spend GitHub's anonymous API limit for us.
  for (const source of [latestFromApi, latestFromPages]) {
    try {
      const value = await source();
      await env.LICENSES.put(LATEST_CACHE_KEY, JSON.stringify({ at: Date.now(), value }));
      return json(value);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  console.error(`[licensing] latest release: ${errors.join("; ")}`);
  if (cached) return json(cached.value);
  return json({ error: "unavailable" }, 502);
}

const GITHUB_HEADERS = { "User-Agent": "study-app-licensing", Accept: "application/vnd.github+json" };

async function latestFromApi(): Promise<LatestRelease> {
  const response = await fetch(LATEST_URL, { headers: GITHUB_HEADERS });
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  const release = (await response.json()) as {
    tag_name?: unknown;
    html_url?: unknown;
    published_at?: unknown;
    assets?: { name?: unknown; browser_download_url?: unknown }[];
  };
  if (typeof release.tag_name !== "string" || typeof release.html_url !== "string") {
    throw new Error("GitHub release without a tag");
  }
  return {
    version: release.tag_name.replace(/^v/, ""),
    tag: release.tag_name,
    url: release.html_url,
    publishedAt: typeof release.published_at === "string" ? release.published_at : null,
    assets: (Array.isArray(release.assets) ? release.assets : [])
      .filter((asset) => typeof asset?.name === "string" && typeof asset.browser_download_url === "string")
      .map((asset) => ({ name: asset.name as string, url: asset.browser_download_url as string })),
  };
}

const RELEASES_PAGE = "https://github.com/neftyhot/study-app/releases";

/** /releases/latest redirects to the tag; its asset list is a plain HTML fragment. */
async function latestFromPages(): Promise<LatestRelease> {
  const redirect = await fetch(`${RELEASES_PAGE}/latest`, {
    headers: { "User-Agent": "study-app-licensing" },
    redirect: "manual",
  });
  const tag = redirect.headers.get("location")?.match(/\/releases\/tag\/([^/?#]+)$/)?.[1];
  if (!tag) throw new Error(`GitHub pages ${redirect.status}`);
  const page = await fetch(`${RELEASES_PAGE}/expanded_assets/${tag}`, {
    headers: { "User-Agent": "study-app-licensing" },
  });
  if (!page.ok) throw new Error(`GitHub assets ${page.status}`);
  const html = await page.text();
  const names = new Set<string>();
  for (const match of html.matchAll(/href="\/neftyhot\/study-app\/releases\/download\/[^/"]+\/([^"]+)"/g)) {
    names.add(decodeURIComponent(match[1]));
  }
  if (!names.size) throw new Error("GitHub release without assets");
  return {
    version: decodeURIComponent(tag).replace(/^v/, ""),
    tag: decodeURIComponent(tag),
    url: `${RELEASES_PAGE}/tag/${tag}`,
    publishedAt: null,
    assets: [...names].map((name) => ({
      name,
      url: `${RELEASES_PAGE}/download/${tag}/${encodeURIComponent(name)}`,
    })),
  };
}

/* --------------------------------------------------------------- Delivery */

async function handleLicenseLookup(machineId: string, env: Env): Promise<Response> {
  if (!MACHINE_ID.test(machineId)) return new Response("Bad machine id", { status: 400 });

  const record = await env.LICENSES.get(`machine:${machineId}`);
  if (!record) return json({ token: null }, 404);

  // A key bound to one machine is useless anywhere else, so handing it to
  // whoever asks with that id gives nothing away.
  const { token, licenseId } = JSON.parse(record) as IssuedLicense;
  // A revoked purchase is not handed back out, or the app would re-activate
  // the key it has just been told to drop.
  if (await isRevoked(env, licenseId)) return json({ token: null }, 404);
  return json({ token });
}

async function handleSuccess(sessionId: string, env: Env): Promise<Response> {
  if (!SESSION_ID.test(sessionId)) {
    return page("Megan Study", "<p>This page needs the link from your checkout.</p>", 400);
  }

  const record = await env.LICENSES.get(`session:${sessionId}`);
  if (!record) {
    // The redirect can beat the webhook by a second or two.
    return page(
      "Finishing up…",
      "<p>Payment received — preparing your license. This page refreshes by itself.</p>",
      200,
      '<meta http-equiv="refresh" content="3">',
    );
  }

  const { token } = JSON.parse(record) as IssuedLicense;
  return page(
    "Thank you — Megan Study is yours",
    `<p>Megan Study should unlock by itself within a few seconds. If it has not, click <b>Already have a license?</b> in the app and paste this key:</p>
<textarea id="key" readonly rows="6">${escapeHtml(token)}</textarea>
<p><button type="button" onclick="navigator.clipboard.writeText(document.getElementById('key').value);this.textContent='Copied'">Copy key</button></p>
<p class="muted">Keep a copy somewhere safe. It works on this computer only.</p>`,
  );
}

/* ---------------------------------------------------------------- Helpers */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function page(title: string, content: string, status = 200, head = ""): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
${head}
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 32px 16px; font: 16px/1.5 system-ui, -apple-system, sans-serif; }
  main { max-width: 34rem; margin: 0 auto; }
  textarea { width: 100%; box-sizing: border-box; font: 12px/1.4 ui-monospace, Menlo, monospace; padding: 8px; }
  button { font: inherit; padding: 6px 14px; cursor: pointer; }
  .muted { opacity: 0.7; font-size: 14px; }
</style>
</head>
<body><main><h1>${escapeHtml(title)}</h1>${content}</main></body>
</html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
