/**
 * The licensing Worker: turns a Stripe payment into a Study App license.
 *
 *   POST /stripe/webhook   Stripe → here. On a paid checkout, mint a
 *                          `lifetime` key for the machine id Stripe carried
 *                          back as `client_reference_id`, and keep it.
 *   GET  /license/:machine The app polls this after opening checkout, and
 *                          activates with whatever it gets — after verifying
 *                          the signature itself, like any pasted key.
 *   GET  /success          Where the Payment Link redirects after paying:
 *                          shows the key, as a fallback to automatic delivery.
 *
 * The key is minted in exactly the format scripts/license-store.mjs produces
 * and electron/license/verify.cjs accepts: base64 of { payload, signature },
 * Ed25519 over the payload bytes as they travel.
 *
 * No dependencies. Stripe's signature check is an HMAC and the license is an
 * Ed25519 signature, and Web Crypto does both — in a Worker and in Node, so
 * the tests run this same file.
 */

export type KVLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

export type Env = {
  /** `whsec_…`, from the webhook endpoint in the Stripe dashboard. */
  STRIPE_WEBHOOK_SECRET: string;
  /** The Ed25519 signing key, PKCS#8 PEM: the contents of .license-private-key.pem. */
  LICENSE_PRIVATE_KEY: string;
  /** When set, only checkouts from this Payment Link (plink_…) mint a key. */
  PAYMENT_LINK_ID?: string;
  LICENSES: KVLike;
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

    if (request.method === "GET" && url.pathname === "/success") {
      return handleSuccess(url.searchParams.get("session_id") ?? "", env);
    }

    return new Response("Not found", { status: 404 });
  },
};

export default worker;

/* ---------------------------------------------------------------- Webhook */

type CheckoutSession = {
  id: string;
  client_reference_id?: string | null;
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

  const record = JSON.stringify(issued);
  await env.LICENSES.put(`session:${session.id}`, record);
  await env.LICENSES.put(`machine:${machineId}`, record);

  return json({ received: true, licenseId: issued.licenseId });
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

/* --------------------------------------------------------------- Delivery */

async function handleLicenseLookup(machineId: string, env: Env): Promise<Response> {
  if (!MACHINE_ID.test(machineId)) return new Response("Bad machine id", { status: 400 });

  const record = await env.LICENSES.get(`machine:${machineId}`);
  if (!record) return json({ token: null }, 404);

  // A key bound to one machine is useless anywhere else, so handing it to
  // whoever asks with that id gives nothing away.
  const { token } = JSON.parse(record) as IssuedLicense;
  return json({ token });
}

async function handleSuccess(sessionId: string, env: Env): Promise<Response> {
  if (!SESSION_ID.test(sessionId)) {
    return page("Study App", "<p>This page needs the link from your checkout.</p>", 400);
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
    "Thank you — Study App is yours",
    `<p>Study App should unlock by itself within a few seconds. If it has not, click <b>Already have a license?</b> in the app and paste this key:</p>
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
