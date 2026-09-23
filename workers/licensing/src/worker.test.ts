/**
 * The licensing Worker, run in Node against the same Web Crypto it uses in
 * Cloudflare. The point of every test here is the last line: the key that
 * comes out must pass the app's own verifier, unmodified.
 */
import { createHmac, generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";

import { beforeEach, describe, expect, it, vi } from "vitest";

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
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.data.set(key, value);
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
