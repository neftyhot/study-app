/**
 * License verification (docs/LICENSING_SPEC.md).
 *
 * These import the same CommonJS the Electron main process loads, not a
 * TypeScript copy of it: a verifier that is transpiled on its way into the
 * bundle is a verifier nobody has actually tested.
 *
 * Signing here uses a throwaway keypair rather than the developer's, so the
 * suite never needs a secret and a leaked test fixture proves nothing.
 */
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Required rather than imported on purpose: this is the exact CommonJS the
 * Electron main process loads, and testing a transpiled copy would test
 * something that never ships.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const verifier = require("../../../electron/license/verify.cjs");
const store = require("../../../electron/license/store.cjs");
const gate = require("../../../electron/license/gate.cjs");
const purchase = require("../../../electron/license/purchase.cjs");
/* eslint-enable @typescript-eslint/no-require-imports */

const { REASON, verifyLicense, daysRemaining, messageFor } = verifier;

const keys = generateKeyPairSync("ed25519");
const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" });

const MACHINE = "machine-aaaa-bbbb";
const DAY = 86_400_000;

type Payload = Record<string, unknown>;

/** Mints a token the same way the CLI does. */
function mint(payload: Payload, key = keys.privateKey): string {
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  return Buffer.from(
    JSON.stringify({
      payload: bytes.toString("base64"),
      signature: sign(null, bytes, key).toString("base64"),
    }),
    "utf8",
  ).toString("base64");
}

function student(overrides: Payload = {}): string {
  return mint({
    id: randomUUID(),
    type: "student",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 14 * DAY,
    machineId: MACHINE,
    ...overrides,
  });
}

function check(token: string, context: Record<string, unknown> = {}) {
  return verifyLicense(token, { publicKeyPem, machineId: MACHINE, ...context });
}

describe("signature integrity", () => {
  it("accepts a token signed by the matching key", () => {
    expect(check(student()).valid).toBe(true);
  });

  it("rejects a token signed by a different key", () => {
    const attacker = generateKeyPairSync("ed25519");
    const forged = student();
    const reforged = mint(
      { id: "x", type: "admin", issuedAt: Date.now() },
      attacker.privateKey,
    );

    expect(check(forged).valid).toBe(true);
    // Self-signed "admin" keys are exactly what asymmetric signing prevents.
    expect(check(reforged).reason).toBe(REASON.badSignature);
  });

  it("rejects a payload edited after signing", () => {
    const token = student({ expiresAt: Date.now() + DAY });
    const outer = JSON.parse(Buffer.from(token, "base64").toString("utf8"));

    const payload = JSON.parse(
      Buffer.from(outer.payload, "base64").toString("utf8"),
    );
    payload.expiresAt = Date.now() + 9999 * DAY;
    outer.payload = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64",
    );

    const tampered = Buffer.from(JSON.stringify(outer), "utf8").toString(
      "base64",
    );

    expect(check(tampered).reason).toBe(REASON.badSignature);
  });

  it("rejects a swapped signature", () => {
    const a = JSON.parse(Buffer.from(student(), "base64").toString("utf8"));
    const b = JSON.parse(
      Buffer.from(student({ id: "other" }), "base64").toString("utf8"),
    );

    const mixed = Buffer.from(
      JSON.stringify({ payload: a.payload, signature: b.signature }),
      "utf8",
    ).toString("base64");

    expect(check(mixed).reason).toBe(REASON.badSignature);
  });

  it("rejects junk without throwing", () => {
    expect(check("not base64 at all!!").valid).toBe(false);
    expect(check(Buffer.from("{}", "utf8").toString("base64")).reason).toBe(
      REASON.malformed,
    );
    expect(check("").reason).toBe(REASON.missing);
    expect(check(undefined as never).reason).toBe(REASON.missing);
  });
});

describe("expiry", () => {
  it("rejects a student key past its expiry", () => {
    const token = student({ expiresAt: Date.now() - 1000 });
    expect(check(token).reason).toBe(REASON.expired);
  });

  it("accepts a student key one minute before expiry", () => {
    const expiresAt = Date.now() + 60_000;
    expect(check(student({ expiresAt })).valid).toBe(true);
  });

  it("rejects a student key with no expiry at all", () => {
    const token = mint({ id: "x", type: "student", machineId: MACHINE });
    // An unbounded student key would be an admin key without saying so.
    expect(check(token).reason).toBe(REASON.expired);
  });

  it("never expires an admin key", () => {
    const token = mint({ id: "x", type: "admin", issuedAt: 0 });
    const inTenYears = Date.now() + 3650 * DAY;

    expect(check(token, { now: inTenYears }).valid).toBe(true);
  });

  it("counts down the days remaining", () => {
    const now = Date.now();
    const payload = { type: "student", expiresAt: now + 3.2 * DAY };

    expect(daysRemaining(payload, now)).toBe(4);
    expect(daysRemaining({ type: "student", expiresAt: now - DAY }, now)).toBe(0);
    expect(daysRemaining({ type: "admin" }, now)).toBeNull();
  });
});

describe("lifetime keys (what a purchase mints)", () => {
  function lifetime(overrides: Payload = {}): string {
    return mint({
      id: randomUUID(),
      type: "lifetime",
      issuedAt: Date.now(),
      machineId: MACHINE,
      ...overrides,
    });
  }

  it("opens on the machine it was bought for, for good", () => {
    const inFiftyYears = Date.now() + 50 * 365 * DAY;
    expect(check(lifetime()).valid).toBe(true);
    expect(check(lifetime(), { now: inFiftyYears }).valid).toBe(true);
    expect(daysRemaining({ type: "lifetime" })).toBeNull();
  });

  it("refuses any other machine", () => {
    expect(check(lifetime({ machineId: "someone-elses-laptop" })).reason).toBe(
      REASON.wrongMachine,
    );
  });

  it("refuses a lifetime key with no machine in it", () => {
    // It would otherwise open on every computer, forever.
    expect(check(lifetime({ machineId: undefined })).reason).toBe(REASON.malformed);
    expect(check(lifetime({ machineId: "" })).reason).toBe(REASON.malformed);
  });

  it("still loses to a clock that has moved backwards", () => {
    const now = Date.now();
    expect(check(lifetime(), { now, lastLaunch: now + DAY }).reason).toBe(
      REASON.clockRollback,
    );
  });
});

describe("hardware binding", () => {
  it("rejects a student key issued for another machine", () => {
    const token = student({ machineId: "someone-elses-laptop" });
    expect(check(token).reason).toBe(REASON.wrongMachine);
  });

  it("accepts a student key with no machine binding", () => {
    const token = student({ machineId: undefined });
    expect(check(token).valid).toBe(true);
  });

  it("ignores machine binding on an admin key", () => {
    const token = mint({
      id: "x",
      type: "admin",
      machineId: "someone-elses-laptop",
    });
    expect(check(token).valid).toBe(true);
  });
});

describe("clock rollback", () => {
  it("refuses everything when the clock has moved backwards", () => {
    const lastLaunch = Date.now();
    const result = check(student(), { now: lastLaunch - DAY, lastLaunch });

    expect(result.reason).toBe(REASON.clockRollback);
  });

  it("refuses an admin key too", () => {
    const lastLaunch = Date.now();
    const token = mint({ id: "x", type: "admin" });

    // A backwards clock invalidates every time-based check that follows, so
    // there is nothing left worth evaluating — including for admins.
    expect(check(token, { now: lastLaunch - 1, lastLaunch }).reason).toBe(
      REASON.clockRollback,
    );
  });

  it("allows time standing still or moving forward", () => {
    const lastLaunch = Date.now();

    expect(check(student(), { now: lastLaunch, lastLaunch }).valid).toBe(true);
    expect(check(student(), { now: lastLaunch + DAY, lastLaunch }).valid).toBe(
      true,
    );
  });

  it("does not trip when there is no recorded launch", () => {
    expect(check(student(), { lastLaunch: null }).valid).toBe(true);
  });

  it("catches the rollback that would otherwise revive an expired key", () => {
    const issued = Date.now();
    const token = student({ expiresAt: issued + DAY });

    // Two days on, the key is expired...
    expect(check(token, { now: issued + 2 * DAY }).reason).toBe(REASON.expired);

    // ...so the obvious move is to set the clock back. That is the attack this
    // check exists for.
    expect(
      check(token, { now: issued, lastLaunch: issued + 2 * DAY }).reason,
    ).toBe(REASON.clockRollback);
  });
});

describe("messages", () => {
  it("explains every refusal in plain words", () => {
    for (const reason of Object.values(REASON) as string[]) {
      const message = messageFor(reason);
      expect(message, reason).toBeTruthy();
      expect(message, reason).not.toContain("_");
    }
  });
});

describe("the license store", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "license-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves and reads a token", () => {
    expect(store.readToken(dir)).toBeNull();

    store.saveToken(dir, "a-token");
    expect(store.readToken(dir)).toBe("a-token");

    store.clearToken(dir);
    expect(store.readToken(dir)).toBeNull();
  });

  it("writes the license file readable only by its owner", () => {
    store.saveToken(dir, "a-token");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mode = require("node:fs").statSync(store.filePath(dir)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("only ever moves the launch clock forward", () => {
    const now = Date.now();

    store.recordLaunch(dir, now);
    expect(store.readLastLaunch(dir)).toBe(now);

    // A backwards clock must not be able to erase the evidence of itself.
    store.recordLaunch(dir, now - 10 * DAY);
    expect(store.readLastLaunch(dir)).toBe(now);

    store.recordLaunch(dir, now + DAY);
    expect(store.readLastLaunch(dir)).toBe(now + DAY);
  });

  it("remembers a clock tamper across restarts", () => {
    expect(store.clockTampered(dir)).toBe(false);

    store.flagClockTamper(dir);
    expect(store.clockTampered(dir)).toBe(true);

    store.clearClockTamper(dir);
    expect(store.clockTampered(dir)).toBe(false);
  });

  it("keeps the token when the launch clock is updated", () => {
    store.saveToken(dir, "a-token");
    store.recordLaunch(dir);
    store.flagClockTamper(dir);

    expect(store.readToken(dir)).toBe("a-token");
  });

  it("treats a corrupt file as no license rather than crashing", () => {
    writeFileSync(store.filePath(dir), "{ not json");

    expect(store.readToken(dir)).toBeNull();
    expect(store.readLastLaunch(dir)).toBeNull();
    expect(store.clockTampered(dir)).toBe(false);
  });
});

describe("the shipped public key", () => {
  it("is an Ed25519 public key and carries no private half", () => {
    const pem = readFileSync(
      join(process.cwd(), "electron/license/license-public-key.pem"),
      "utf8",
    );

    expect(pem).toContain("BEGIN PUBLIC KEY");
    expect(pem).not.toContain("PRIVATE");
  });
});

describe("the gate", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gate-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("opens on a 7-day free trial with no license at all", () => {
    const now = Date.now();
    const result = gate.evaluate(dir, now);

    expect(gate.TRIAL_DAYS).toBe(7);
    expect(result).toMatchObject({ valid: true, trial: true, daysRemaining: 7 });
    expect(result.payload).toEqual({ type: "trial", expiresAt: now + 7 * DAY });
    expect(result.machineId).toBeTruthy();
  });

  it("counts the trial from the first launch, not the latest", () => {
    const first = Date.now();
    gate.evaluate(dir, first);

    const later = gate.evaluate(dir, first + 5.5 * DAY);
    expect(later).toMatchObject({ valid: true, trial: true, daysRemaining: 2 });
    expect(store.readTrialStart(dir)).toBe(first);
  });

  it("locks when the trial runs out, and says so", () => {
    const first = Date.now();
    gate.evaluate(dir, first);

    const lastMinute = gate.evaluate(dir, first + 7 * DAY - 60_000);
    expect(lastMinute).toMatchObject({ valid: true, daysRemaining: 1 });

    const over = gate.evaluate(dir, first + 7 * DAY);
    expect(over).toMatchObject({ valid: false, trial: false, reason: REASON.trialEnded });
    expect(over.message).toMatch(/trial has ended/);
  });

  it("gives a present-but-bad key its own reason once the trial is over", () => {
    const first = Date.now();
    gate.evaluate(dir, first);
    store.saveToken(dir, "obvious-nonsense");

    expect(gate.evaluate(dir, first + DAY).valid).toBe(true);
    expect(gate.evaluate(dir, first + 8 * DAY).reason).toBe(REASON.malformed);
  });

  it("never stretches the trial with a moved-back clock", () => {
    const first = Date.now();
    gate.evaluate(dir, first);
    store.recordLaunch(dir, first + 6 * DAY);

    const rolledBack = gate.evaluate(dir, first + DAY);
    expect(rolledBack).toMatchObject({ valid: false, reason: REASON.clockRollback });
  });

  it("stores a key only once it verifies", () => {
    const rejected = gate.activate(dir, "obvious-nonsense");

    expect(rejected.valid).toBe(false);
    expect(store.readToken(dir)).toBeNull();
  });

  it("locks the app permanently once the clock has been moved back", () => {
    const now = Date.now();
    store.recordLaunch(dir, now);

    // Running with the clock a day behind trips the check...
    gate.evaluate(dir, now - DAY);
    expect(store.clockTampered(dir)).toBe(true);

    // ...and putting the clock back does not quietly restore access, or the
    // check would be worth nothing.
    expect(gate.evaluate(dir, now + DAY).reason).toBe(REASON.clockRollback);
  });

  it("reports the machine id the activation screen shows", () => {
    expect(gate.machineId()).toBe(gate.evaluate(dir).machineId);
    expect(gate.machineId().length).toBeGreaterThan(8);
  });
});

describe("buying a license", () => {
  const saved = process.env.LICENSE_SERVER_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.LICENSE_SERVER_URL;
    else process.env.LICENSE_SERVER_URL = saved;
  });

  it("opens the Payment Link with this machine as the reference", () => {
    expect(purchase.purchaseUrl("8C1A2B3D-4E5F-6071-8293-A4B5C6D7E8F9")).toBe(
      "https://buy.stripe.com/test_eVqbIU35hbtp0Kk0CB14400?client_reference_id=8C1A2B3D-4E5F-6071-8293-A4B5C6D7E8F9",
    );
  });

  it("asks nobody when no licensing server is configured", async () => {
    delete process.env.LICENSE_SERVER_URL;
    const fetchImpl = vi.fn();

    expect(await purchase.fetchPurchasedLicense("m", fetchImpl)).toEqual({
      configured: false,
      token: null,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("collects the key minted for this machine", async () => {
    process.env.LICENSE_SERVER_URL = "https://licensing.example/";
    const fetchImpl = vi.fn<(url: string) => Promise<Response>>(async () =>
      Response.json({ token: "the-token" }),
    );

    expect(await purchase.fetchPurchasedLicense("M 1", fetchImpl)).toEqual({
      configured: true,
      token: "the-token",
    });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://licensing.example/license/M%201");
  });

  it("treats not-yet, a server error, and being offline as nothing yet", async () => {
    process.env.LICENSE_SERVER_URL = "https://licensing.example";
    for (const fetchImpl of [
      async () => Response.json({ token: null }, { status: 404 }),
      async () => new Response("oops", { status: 500 }),
      async () => {
        throw new TypeError("fetch failed");
      },
    ]) {
      expect(await purchase.fetchPurchasedLicense("m", fetchImpl)).toEqual({
        configured: true,
        token: null,
      });
    }
  });
});
