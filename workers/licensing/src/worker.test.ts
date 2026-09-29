/**
 * The licensing Worker, run in Node against the same Web Crypto it uses in
 * Cloudflare. The point of every test here is the last line: the key that
 * comes out must pass the app's own verifier, unmodified.
 */
import { createHmac, generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import worker, { verifyStripeSignature, type Env, type KVLike } from "./index";

const require = createRequire(import.meta.url);
const { verifyLicense } = require("../../../electron/license/verify.cjs") as {
  verifyLicense: (
    token: string,
    context: { machineId?: string; publicKeyPem?: string; now?: number },
  ) => { valid: boolean; reason?: string; payload?: Record<string, unknown> };
};

const MACHINE = "8C1A2B3D-4E5F-6071-8293-A4B5C6D7E8F9";
const SECRET = "whsec_test_secret";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

class MemoryKV implements KVLike {
  readonly data = new Map<string, string>();
  readonly metadata = new Map<string, unknown>();
  /** Reads started but not yet answered, and the most there ever were at once. */
  inFlight = 0;
  maxInFlight = 0;
  async get(key: string) {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await Promise.resolve();
    this.inFlight -= 1;
    return this.data.get(key) ?? null;
  }
  async put(key: string, value: string, options?: { metadata?: unknown }) {
    this.data.set(key, value);
    if (options?.metadata !== undefined) this.metadata.set(key, structuredClone(options.metadata));
    else this.metadata.delete(key);
  }
  async delete(key: string) {
    this.data.delete(key);
    this.metadata.delete(key);
  }
  async list({ prefix }: { prefix: string; cursor?: string }) {
    return {
      keys: [...this.data.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((name) => (this.metadata.has(name) ? { name, metadata: this.metadata.get(name) } : { name })),
      list_complete: true,
    };
  }
}

let kv: MemoryKV;
let env: Env;

beforeEach(() => {
  kv = new MemoryKV();
  env = { STRIPE_WEBHOOK_SECRET: SECRET, LICENSE_PRIVATE_KEY: PRIVATE_PEM, LICENSES: kv };
});

function checkoutEvent(overrides: Record<string, unknown> = {}, type = "checkout.session.completed") {
  return JSON.stringify({
    id: "evt_1",
    type,
    data: {
      object: {
        id: "cs_test_abc123",
        object: "checkout.session",
        client_reference_id: MACHINE,
        payment_status: "paid",
        payment_link: "plink_123",
        amount_total: 2495,
        currency: "usd",
        customer_details: { email: "student@example.com", name: "Sam Student" },
        ...overrides,
      },
    },
  });
}

function sign(body: string, timestamp = Math.floor(Date.now() / 1000), secret = SECRET) {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

function webhook(body: string, signature: string | null = sign(body)) {
  return worker.fetch(
    new Request("https://licensing.example/stripe/webhook", {
      method: "POST",
      body,
      headers: signature ? { "Stripe-Signature": signature } : {},
    }),
    env,
  );
}

function get(path: string) {
  return worker.fetch(new Request(`https://licensing.example${path}`), env);
}

describe("the Stripe webhook", () => {
  it("mints a lifetime key the app accepts, bound to the paying machine", async () => {
    const response = await webhook(checkoutEvent());
    expect(response.status).toBe(200);

    const lookup = await get(`/license/${MACHINE}`);
    expect(lookup.status).toBe(200);
    const { token } = (await lookup.json()) as { token: string };

    const onThisMachine = verifyLicense(token, { machineId: MACHINE, publicKeyPem: PUBLIC_PEM });
    expect(onThisMachine.valid).toBe(true);
    expect(onThisMachine.payload).toMatchObject({
      type: "lifetime",
      machineId: MACHINE,
      name: "Sam Student",
    });
    // Lifetime: still good in fifty years.
    expect(
      verifyLicense(token, {
        machineId: MACHINE,
        publicKeyPem: PUBLIC_PEM,
        now: Date.now() + 50 * 365 * 86_400_000,
      }).valid,
    ).toBe(true);

    const elsewhere = verifyLicense(token, { machineId: "some-other-mac", publicKeyPem: PUBLIC_PEM });
    expect(elsewhere).toMatchObject({ valid: false, reason: "wrong_machine" });
  });

  it("rejects an unsigned, forged, or stale webhook and mints nothing", async () => {
    const body = checkoutEvent();

    expect((await webhook(body, null)).status).toBe(400);
    expect((await webhook(body, sign(body, undefined, "whsec_wrong"))).status).toBe(400);
    expect((await webhook(body, sign(body, Math.floor(Date.now() / 1000) - 3600))).status).toBe(400);
    // Signed, then altered: the machine id swapped for an attacker's.
    const tampered = body.replace(MACHINE, "attacker-machine");
    expect((await webhook(tampered, sign(body))).status).toBe(400);

    expect(kv.data.size).toBe(0);
  });

  it("issues one key per purchase, however often Stripe retries", async () => {
    const body = checkoutEvent();
    await webhook(body);
    const first = kv.data.get(`machine:${MACHINE}`);

    const retry = await webhook(body);
    expect(await retry.json()).toMatchObject({ duplicate: true });
    expect(kv.data.get(`machine:${MACHINE}`)).toBe(first);
  });

  it("waits for an async payment to clear, then mints on its own event", async () => {
    await webhook(checkoutEvent({ payment_status: "unpaid" }));
    expect(kv.data.size).toBe(0);

    await webhook(checkoutEvent({}, "checkout.session.async_payment_succeeded"));
    expect(kv.data.has(`machine:${MACHINE}`)).toBe(true);
  });

  it("acknowledges but does not mint without a usable machine id", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const bad of [null, "", "has spaces", "x".repeat(201)]) {
        const response = await webhook(checkoutEvent({ client_reference_id: bad }));
        expect(response.status).toBe(200);
      }
      expect(kv.data.size).toBe(0);
    } finally {
      error.mockRestore();
    }
  });

  it("ignores other events, and other payment links when one is pinned", async () => {
    await webhook(checkoutEvent({}, "payment_intent.succeeded"));
    expect(kv.data.size).toBe(0);

    env.PAYMENT_LINK_ID = "plink_other";
    await webhook(checkoutEvent());
    expect(kv.data.size).toBe(0);

    env.PAYMENT_LINK_ID = "plink_123";
    await webhook(checkoutEvent());
    expect(kv.data.size).toBe(2);
  });
});

describe("delivery", () => {
  it("answers 404 for a machine with no purchase, and refuses junk ids", async () => {
    expect((await get(`/license/${MACHINE}`)).status).toBe(404);
    expect((await get("/license/bad%20id")).status).toBe(400);
  });

  it("shows the key on the success page once the webhook has landed", async () => {
    const waiting = await get("/success?session_id=cs_test_abc123");
    expect(await waiting.text()).toContain('http-equiv="refresh"');

    await webhook(checkoutEvent());
    const { token } = (await (await get(`/license/${MACHINE}`)).json()) as { token: string };

    const ready = await (await get("/success?session_id=cs_test_abc123")).text();
    expect(ready).toContain(token);
    expect(ready).toContain("Already have a license?");

    expect((await get("/success?session_id=<script>")).status).toBe(400);
  });
});

describe("Stripe's signature format", () => {
  it("accepts any v1 while a secret is being rolled", async () => {
    const body = "{}";
    const now = Math.floor(Date.now() / 1000);
    const good = sign(body, now).split(",")[1];
    const header = `t=${now},v1=deadbeef,${good},v0=ignored`;

    expect(await verifyStripeSignature(body, header, SECRET, now)).toBe(true);
    expect(await verifyStripeSignature(body, `t=${now},v1=deadbeef`, SECRET, now)).toBe(false);
    expect(await verifyStripeSignature(body, "garbage", SECRET, now)).toBe(false);
  });
});

describe("feedback", () => {
  function post(body: unknown) {
    return worker.fetch(
      new Request("https://licensing.example/feedback", {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      env,
    );
  }

  it("keeps a suggestion under a feedback: key", async () => {
    const response = await post({ text: "  Dark mode for diagrams  ", contact: "me@x.com", version: "0.2.0" });
    expect(response.status).toBe(201);

    const [[key, value]] = [...kv.data.entries()];
    expect(key.startsWith("feedback:")).toBe(true);
    expect(JSON.parse(value)).toMatchObject({ text: "Dark mode for diagrams", contact: "me@x.com", version: "0.2.0" });
  });

  it("refuses an empty or malformed suggestion", async () => {
    expect((await post({ text: "   " })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(kv.data.size).toBe(0);
  });

  it("caps the length", async () => {
    await post({ text: "x".repeat(20_000) });
    // A body past the read limit is not valid JSON once cut, so either it is
    // refused or stored short — never stored whole.
    for (const value of kv.data.values()) {
      expect(JSON.parse(value).text.length).toBeLessThanOrEqual(5000);
    }
    await post({ text: "y".repeat(9_000) });
    const stored = [...kv.data.values()].map((value) => JSON.parse(value).text as string);
    expect(stored.some((text) => text.startsWith("y") && text.length === 5000)).toBe(true);
  });
});

describe("telemetry and admin", () => {
  const TOKEN = "admin-token-for-tests-0123456789";
  const INSTALL = "3f2b8c4e-1111-4222-8333-944455556666";

  function call(path: string, init: RequestInit = {}, token: string | null = TOKEN) {
    return worker.fetch(
      new Request(`https://licensing.example${path}`, {
        ...init,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
      { ...env, ADMIN_TOKEN: TOKEN },
    );
  }

  function report(overrides: Record<string, unknown> = {}) {
    return call("/telemetry", {
      method: "POST",
      body: JSON.stringify({
        installId: INSTALL,
        version: "0.2.0",
        platform: "darwin-arm64",
        focusedSeconds: 3600,
        backgroundSeconds: 600,
        subjects: 2,
        decks: 3,
        cards: 400,
        reviewed: 120,
        usage: [
          { feature: "generate", provider: "gemini", model: "gemini-2.5-flash", authMode: "api_key", calls: 10, inputTokens: 50_000, outputTokens: 20_000, costUsd: 0.12 },
        ],
        ...overrides,
      }),
    }, null);
  }

  it("keeps one record per install, replaced by each report", async () => {
    await report();
    await report({ focusedSeconds: 7200, version: "0.2.1" });
    await call("/telemetry", { method: "POST", body: JSON.stringify({ installId: "a1b2c3d4-0000-4000-8000-000000000000", version: "0.2.0" }) }, null);

    const stats = await (await call("/admin/stats")).json();
    expect(stats.installs).toBe(2);
    expect(stats.totals.focusedSeconds).toBe(7200);
    expect(stats.totals.inputTokens).toBe(50_000);
    expect(stats.versions).toEqual(
      expect.arrayContaining([
        { version: "0.2.1", count: 1, percent: 50 },
        { version: "0.2.0", count: 1, percent: 50 },
      ]),
    );
    expect(stats.byFeature[0]).toMatchObject({ name: "generate", calls: 10 });
  });

  it("refuses a report without a proper install id", async () => {
    expect((await report({ installId: "../../etc" })).status).toBe(400);
  });

  it("keeps the admin routes behind the token", async () => {
    expect((await call("/admin/stats", {}, null)).status).toBe(401);
    expect((await call("/admin/stats", {}, "wrong-token-wrong-token-wrong-tok")).status).toBe(401);
    expect((await call("/admin/feedback", {}, null)).status).toBe(401);
  });

  it("lists and deletes suggestions", async () => {
    await worker.fetch(
      new Request("https://licensing.example/feedback", { method: "POST", body: JSON.stringify({ text: "Add dark mode" }) }),
      env,
    );
    const list = await (await call("/admin/feedback")).json();
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe("Add dark mode");

    await call(`/admin/feedback/${encodeURIComponent(list[0].key)}`, { method: "DELETE" });
    expect(await (await call("/admin/feedback")).json()).toHaveLength(0);
  });

  it("keeps a revoked key from being checked in or handed back out", async () => {
    await webhook(checkoutEvent());
    const { token } = (await (await get(`/license/${MACHINE}`)).json()) as { token: string };
    const { payload } = verifyLicense(token, { machineId: MACHINE, publicKeyPem: PUBLIC_PEM });
    const id = payload!.id as string;

    expect(await (await call(`/revoked/${id}`, {}, null)).json()).toEqual({ revoked: false });
    expect((await call("/admin/revocations", { method: "PUT", body: JSON.stringify({ ids: [id] }) }, null)).status).toBe(401);

    await call("/admin/revocations", { method: "PUT", body: JSON.stringify({ ids: [id, "../bad"] }) });
    expect(await (await call(`/revoked/${id}`, {}, null)).json()).toEqual({ revoked: true });
    expect((await call(`/license/${MACHINE}`, {}, null)).status).toBe(404);

    // Restoring is the same list with the id left out.
    await call("/admin/revocations", { method: "PUT", body: JSON.stringify({ ids: [] }) });
    expect(await (await call(`/revoked/${id}`, {}, null)).json()).toEqual({ revoked: false });
    expect((await call(`/license/${MACHINE}`, {}, null)).status).toBe(200);
  });

  it("lists purchased keys for the License Manager, to the admin only", async () => {
    await webhook(checkoutEvent());
    expect((await call("/admin/purchases", {}, null)).status).toBe(401);

    const list = (await (await call("/admin/purchases")).json()) as {
      token: string;
      licenseId: string;
      email: string;
    }[];
    expect(list).toHaveLength(1);
    expect(list[0].email).toBe("student@example.com");
    const { payload } = verifyLicense(list[0].token, { machineId: MACHINE, publicKeyPem: PUBLIC_PEM });
    expect(payload!.id).toBe(list[0].licenseId);
  });
});

describe("hourly telemetry, cached stats, erasure", () => {
  const TOKEN = "admin-token-for-tests-0123456789";
  const INSTALL = "3f2b8c4e-1111-4222-8333-944455556666";
  const MINUTE = 60_000;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function call(path: string, init: RequestInit = {}, token: string | null = TOKEN) {
    return worker.fetch(
      new Request(`https://licensing.example${path}`, {
        ...init,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
      { ...env, ADMIN_TOKEN: TOKEN },
    );
  }

  function report(overrides: Record<string, unknown> = {}) {
    return call("/telemetry", {
      method: "POST",
      body: JSON.stringify({ installId: INSTALL, version: "0.2.0", subjects: 1, decks: 1, cards: 10, reviewed: 5, focusedSeconds: 60, ...overrides }),
    }, null);
  }

  const stored = () => JSON.parse(kv.data.get(`telemetry:${INSTALL}`)!);
  const later = (minutes: number) => vi.setSystemTime(Date.now() + minutes * MINUTE);

  it("writes a report only when it is worth a write", async () => {
    await report();
    const first = stored().lastSeen;

    // Nothing changed, 20 minutes on: acknowledged, not written.
    later(20);
    expect(await (await report({ focusedSeconds: 999 })).json()).toEqual({ ok: true });
    expect(stored().lastSeen).toBe(first);

    // Unchanged for 50 minutes: written, so lastSeen stays within the hour.
    later(30);
    await report({ focusedSeconds: 1200 });
    expect(stored().focusedSeconds).toBe(1200);
    const second = stored().lastSeen;

    // Counts changed, but only 5 minutes after the last write: skipped.
    later(5);
    await report({ cards: 11 });
    expect(stored().cards).toBe(10);
    expect(stored().lastSeen).toBe(second);

    // Changed and 10 minutes on: written.
    later(5);
    await report({ cards: 12 });
    expect(stored().cards).toBe(12);

    // A new version is written at once.
    later(1);
    await report({ cards: 12, version: "0.3.0" });
    expect(stored().version).toBe("0.3.0");
    expect(stored().firstSeen).toBe(first);
  });

  it("caches /admin/stats for about ten minutes, unless asked for fresh", async () => {
    await report();
    expect((await (await call("/admin/stats")).json()).installs).toBe(1);
    expect(JSON.parse(kv.data.get("stats:cache")!)).toMatchObject({ at: Date.now(), value: { installs: 1 } });

    await report({ installId: "a1b2c3d4-0000-4000-8000-000000000000" });
    expect((await (await call("/admin/stats")).json()).installs).toBe(1);
    expect((await (await call("/admin/stats?fresh=1")).json()).installs).toBe(2);

    await report({ installId: "b1b2c3d4-0000-4000-8000-000000000000" });
    later(11);
    expect((await (await call("/admin/stats")).json()).installs).toBe(3);
  });

  it("reads many installs in bounded batches", async () => {
    for (let i = 0; i < 130; i += 1) {
      const id = `${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
      kv.data.set(`telemetry:${id}`, JSON.stringify({ installId: id, version: "0.2.0", usage: [], lastSeen: new Date().toISOString(), firstSeen: new Date().toISOString() }));
    }
    kv.maxInFlight = 0;
    expect((await (await call("/admin/stats?fresh=1")).json()).installs).toBe(130);
    expect(kv.maxInFlight).toBeLessThanOrEqual(50);
  });

  it("forgets an install on request, and the cached totals with it", async () => {
    await report();
    await call("/admin/stats");
    expect(kv.data.has("stats:cache")).toBe(true);

    const response = await call(`/telemetry/${INSTALL}`, { method: "DELETE" }, null);
    expect(await response.json()).toEqual({ ok: true });
    expect(kv.data.has(`telemetry:${INSTALL}`)).toBe(false);
    expect(kv.data.has("stats:cache")).toBe(false);
    expect((await (await call("/admin/stats")).json()).installs).toBe(0);

    // Already gone is still fine; junk is not.
    expect((await call(`/telemetry/${INSTALL}`, { method: "DELETE" }, null)).status).toBe(200);
    expect((await call("/telemetry/..%2Fetc", { method: "DELETE" }, null)).status).toBe(400);
  });
});

describe("admin token rotation", () => {
  const CURRENT = "current-admin-token-0123456789";
  const NEXT = "next-admin-token-abcdefghijklmn";

  function stats(token: string, extra: Partial<Env> = {}) {
    return worker.fetch(
      new Request("https://licensing.example/admin/stats", { headers: { authorization: `Bearer ${token}` } }),
      { ...env, ADMIN_TOKEN: CURRENT, ADMIN_TOKEN_NEXT: NEXT, ...extra },
    );
  }

  it("accepts the current or the next token, and nothing else", async () => {
    expect((await stats(CURRENT)).status).toBe(200);
    expect((await stats(NEXT)).status).toBe(200);
    expect((await stats("someone-elses-token-0123456789")).status).toBe(401);
    // Rotation done: the old one is dropped.
    expect((await stats(CURRENT, { ADMIN_TOKEN: NEXT, ADMIN_TOKEN_NEXT: undefined })).status).toBe(401);
    // A too-short token is never accepted, in either slot.
    expect((await stats("short", { ADMIN_TOKEN_NEXT: "short" })).status).toBe(401);
  });
});

describe("purchases, refunds and reissues", () => {
  const TOKEN = "admin-token-for-tests-0123456789";
  const NEW_MACHINE = "NEW-MAC-0000-1111-2222-333344445555";

  function call(path: string, init: RequestInit = {}, token: string | null = TOKEN) {
    return worker.fetch(
      new Request(`https://licensing.example${path}`, {
        ...init,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
      { ...env, ADMIN_TOKEN: TOKEN },
    );
  }

  function charge(type: string, object: Record<string, unknown>) {
    return webhook(JSON.stringify({ id: "evt_2", type, data: { object } }));
  }

  async function buy() {
    await webhook(checkoutEvent({ payment_intent: "pi_123" }));
    return JSON.parse(kv.data.get("session:cs_test_abc123")!) as { licenseId: string; token: string };
  }

  const revoked = async (id: string) => ((await (await get(`/revoked/${id}`)).json()) as { revoked: boolean }).revoked;

  it("lists purchases from key metadata, reading only keys that lack it", async () => {
    const { licenseId, token } = await buy();
    expect(kv.metadata.get("session:cs_test_abc123")).toMatchObject({ licenseId, token, email: "student@example.com" });

    // One written before metadata existed.
    kv.data.set("session:cs_old", JSON.stringify({ token: "old-token", licenseId: "old-id", email: null, issuedAt: 1 }));

    const read = vi.spyOn(kv, "get");
    const list = (await (await call("/admin/purchases")).json()) as { token: string; licenseId: string }[];
    expect(list.map((entry) => entry.licenseId).sort()).toEqual([licenseId, "old-id"].sort());
    expect(list.find((entry) => entry.licenseId === licenseId)!.token).toBe(token);
    expect(read.mock.calls.map(([key]) => key).filter((key) => key.startsWith("session:"))).toEqual(["session:cs_old"]);
  });

  it("leaves the token out of metadata when it would not fit, and still lists it", async () => {
    await webhook(checkoutEvent({ customer_details: { email: "a@b.c", name: "N".repeat(900) } }));
    const metadata = kv.metadata.get("session:cs_test_abc123") as Record<string, unknown>;
    expect(metadata.token).toBeUndefined();
    expect(JSON.stringify(metadata).length).toBeLessThanOrEqual(1024);

    const [entry] = (await (await call("/admin/purchases")).json()) as { token: string }[];
    expect(verifyLicense(entry.token, { machineId: MACHINE, publicKeyPem: PUBLIC_PEM }).valid).toBe(true);
  });

  it("revokes the key on a full refund, but not a partial one", async () => {
    const { licenseId } = await buy();
    expect(kv.data.get("pi:pi_123")).toBe("cs_test_abc123");

    await charge("charge.refunded", { payment_intent: "pi_123", amount: 2495, amount_refunded: 500, refunded: false });
    expect(await revoked(licenseId)).toBe(false);

    const response = await charge("charge.refunded", { payment_intent: "pi_123", amount: 2495, amount_refunded: 2495, refunded: true });
    expect(await response.json()).toMatchObject({ revoked: licenseId });
    expect(await revoked(licenseId)).toBe(true);
    expect((await get(`/license/${MACHINE}`)).status).toBe(404);

    // Stripe retries; the list does not grow.
    await charge("charge.refunded", { payment_intent: "pi_123", refunded: true });
    expect(JSON.parse(kv.data.get("revoked:auto")!)).toEqual([licenseId]);

    // The License Manager replacing its own list does not undo it.
    await call("/admin/revocations", { method: "PUT", body: JSON.stringify({ ids: [] }) });
    expect(await revoked(licenseId)).toBe(true);
    const [purchase] = (await (await call("/admin/purchases")).json()) as { revoked: boolean }[];
    expect(purchase.revoked).toBe(true);
  });

  it("revokes the key when a dispute opens, and ignores payments it never minted for", async () => {
    const { licenseId } = await buy();

    const unknown = await charge("charge.dispute.created", { payment_intent: "pi_someone_else", charge: "ch_1" });
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toMatchObject({ unknown: true });
    expect(kv.data.has("revoked:auto")).toBe(false);

    await charge("charge.dispute.created", { payment_intent: "pi_123", charge: "ch_1" });
    expect(await revoked(licenseId)).toBe(true);
  });

  it("reissues a purchase to a new machine and revokes the old key", async () => {
    const { licenseId } = await buy();

    const body = JSON.stringify({ licenseId, machineId: NEW_MACHINE });
    expect((await call("/admin/reissue", { method: "POST", body }, null)).status).toBe(401);
    expect((await call("/admin/reissue", { method: "POST", body: JSON.stringify({ licenseId, machineId: "bad id" }) })).status).toBe(400);
    expect((await call("/admin/reissue", { method: "POST", body: JSON.stringify({ licenseId: "nope", machineId: NEW_MACHINE }) })).status).toBe(404);

    const response = await call("/admin/reissue", { method: "POST", body });
    expect(response.status).toBe(200);
    const issued = (await response.json()) as { token: string; licenseId: string; revoked: string };
    expect(issued.revoked).toBe(licenseId);

    const check = verifyLicense(issued.token, { machineId: NEW_MACHINE, publicKeyPem: PUBLIC_PEM });
    expect(check.valid).toBe(true);
    expect(check.payload).toMatchObject({ type: "lifetime", name: "Sam Student", id: issued.licenseId });

    expect(await revoked(licenseId)).toBe(true);
    expect((await get(`/license/${MACHINE}`)).status).toBe(404);
    expect(await (await get(`/license/${NEW_MACHINE}`)).json()).toEqual({ token: issued.token });
    const [purchase] = (await (await call("/admin/purchases")).json()) as { token: string; email: string }[];
    expect(purchase).toMatchObject({ token: issued.token, email: "student@example.com" });

    // By session id works too; and a later refund revokes whichever key is current.
    const again = (await (await call("/admin/reissue", {
      method: "POST",
      body: JSON.stringify({ sessionId: "cs_test_abc123", machineId: MACHINE }),
    })).json()) as { licenseId: string };
    await charge("charge.refunded", { payment_intent: "pi_123", refunded: true });
    expect(await revoked(again.licenseId)).toBe(true);
  });
});

describe("GET /latest", () => {
  const release = {
    tag_name: "v0.4.1",
    html_url: "https://github.com/neftyhot/study-app/releases/tag/v0.4.1",
    published_at: "2026-09-20T10:00:00Z",
    assets: [
      { name: "Megan-Study-0.4.1-arm64.dmg", browser_download_url: "https://github.com/x/0.4.1-arm64.dmg" },
      { name: "junk" },
    ],
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("answers from GitHub, then from its cache", async () => {
    const fetchMock = vi.fn(async () => Response.json(release));
    vi.stubGlobal("fetch", fetchMock);

    const response = await get("/latest");
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.json()).toEqual({
      version: "0.4.1",
      tag: "v0.4.1",
      url: release.html_url,
      publishedAt: release.published_at,
      assets: [{ name: "Megan-Study-0.4.1-arm64.dmg", url: "https://github.com/x/0.4.1-arm64.dmg" }],
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/neftyhot/study-app/releases/latest");
    expect(new Headers(init.headers).get("user-agent")).toBeTruthy();

    await get("/latest");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves a stale answer when GitHub fails, and 502 with nothing cached", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 403 })));
      expect((await get("/latest")).status).toBe(502);

      vi.stubGlobal("fetch", vi.fn(async () => Response.json(release)));
      await get("/latest");

      vi.setSystemTime(Date.now() + 11 * 60_000);
      const failing = vi.fn(async () => {
        throw new Error("offline");
      });
      vi.stubGlobal("fetch", failing);
      const stale = await get("/latest");
      expect(failing).toHaveBeenCalled();
      expect(((await stale.json()) as { version: string }).version).toBe("0.4.1");
    } finally {
      error.mockRestore();
    }
  });
});

describe("remote config", () => {
  const TOKEN = "admin-token-for-tests-0123456789";

  function put(body: unknown, token: string | null = TOKEN) {
    return worker.fetch(
      new Request("https://licensing.example/admin/config", {
        method: "PUT",
        body: JSON.stringify(body),
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
      { ...env, ADMIN_TOKEN: TOKEN },
    );
  }

  it("serves {} until set, publicly cacheable", async () => {
    const response = await get("/config");
    expect(await response.json()).toEqual({});
    expect(response.headers.get("cache-control")).toBe("public, max-age=600");
  });

  it("stores only known model slots with plausible ids, for the admin only", async () => {
    expect((await put({ models: { gemini: "gemini-3-flash" } }, null)).status).toBe(401);

    const stored = await put({
      models: {
        gemini: "gemini-3-flash",
        geminiBulk: "models/gemini-3-flash-lite:latest",
        anthropic: "<script>",
        openai: "x".repeat(81),
        geminiPrimer: 42,
        somethingElse: "gpt-9",
      },
      extra: true,
    });
    const expected = { models: { gemini: "gemini-3-flash", geminiBulk: "models/gemini-3-flash-lite:latest" } };
    expect(await stored.json()).toEqual(expected);
    expect(await (await get("/config")).json()).toEqual(expected);
  });
});

describe("app status", () => {
  const TOKEN = "admin-token-for-tests-0123456789";

  function put(body: unknown, token: string | null = TOKEN) {
    return worker.fetch(
      new Request("https://licensing.example/admin/status", {
        method: "PUT",
        body: JSON.stringify(body),
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
      { ...env, ADMIN_TOKEN: TOKEN },
    );
  }

  it("is normal until set, cacheable for a minute only", async () => {
    const response = await get("/status");
    expect(await response.json()).toMatchObject({ mode: "normal", message: "", minVersion: null, features: {}, until: null });
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("stores a sanitised status, for the admin only", async () => {
    expect((await put({ mode: "maintenance" }, null)).status).toBe(401);
    expect((await put({ mode: "maintenance" }, "wrong-token")).status).toBe(401);

    const until = Date.now() + 60 * 60 * 1000;
    const stored = await (
      await put({
        mode: "ai_paused",
        message: `  Back soon.${"x".repeat(600)}`,
        minVersion: "1.5.0",
        features: { tutor: false, decks: true, somethingElse: false },
        until,
        extra: 1,
      })
    ).json();
    expect(stored).toMatchObject({ mode: "ai_paused", minVersion: "1.5.0", features: { tutor: false }, until });
    expect(stored.message).toHaveLength(500);
    expect(stored.message.startsWith("Back soon.")).toBe(true);
    expect(stored.extra).toBeUndefined();
    expect(await (await get("/status")).json()).toEqual(stored);
  });

  it("falls back to normal for anything it does not understand", async () => {
    const stored = await (
      await put({ mode: "panic", minVersion: "latest", until: Date.now() - 1000, features: "all" })
    ).json();
    expect(stored).toMatchObject({ mode: "normal", minVersion: null, until: null, features: {} });
    expect((await put("{not json" as unknown)).status).toBe(200);
  });
});
