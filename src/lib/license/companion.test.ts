/**
 * The iPhone's license rules (packages/core/src/license/companion.ts): the
 * desktop's keys open the phone on any machine id, with the trial, the
 * revocation list and the 45-day confirmation the desktop has.
 */
import { createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  CONFIRM_DAYS,
  EMPTY_LICENSE_STATE,
  checkCompanionToken,
  decideAccess,
  needsRecheck,
  parseLicenseState,
  recordRevocation,
  tokenFromLicenseLink,
  type LicensePayload,
  type PhoneLicenseState,
  type SignatureVerifier,
} from "@megan/core/license/companion";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 22, 12);
const keys = generateKeyPairSync("ed25519");

function mint(payload: LicensePayload, key = keys.privateKey): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return Buffer.from(
    JSON.stringify({ payload: bytes.toString("base64"), signature: sign(null, bytes, key).toString("base64") }),
  ).toString("base64");
}

const verifier: SignatureVerifier = async (signedBytes, signature) =>
  verify(null, Buffer.from(signedBytes, "base64"), keys.publicKey, Buffer.from(signature, "base64"));

const lifetime = (id = "lic-1") => mint({ id, type: "lifetime", machineId: "a".repeat(64) });

describe("checking a key on the phone", () => {
  it("takes a lifetime key bought on another machine, and admin keys", async () => {
    expect(await checkCompanionToken(lifetime(), verifier, T0)).toMatchObject({ ok: true });
    expect(await checkCompanionToken(mint({ id: "a", type: "admin" }), verifier, T0)).toMatchObject({ ok: true });
  });

  it("refuses forged, edited, unreadable, unknown and expired keys", async () => {
    const attacker = generateKeyPairSync("ed25519");
    expect(await checkCompanionToken(mint({ type: "admin" }, attacker.privateKey), verifier, T0)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(await checkCompanionToken("not a key", verifier, T0)).toEqual({ ok: false, reason: "malformed" });
    expect(await checkCompanionToken("  ", verifier, T0)).toEqual({ ok: false, reason: "missing" });
    expect(await checkCompanionToken(mint({ type: "lifetime" }), verifier, T0)).toEqual({ ok: false, reason: "malformed" });
    expect(await checkCompanionToken(mint({ type: "gift" }), verifier, T0)).toEqual({ ok: false, reason: "unknown_type" });
    const student = mint({ type: "student", expiresAt: T0 + DAY });
    expect(await checkCompanionToken(student, verifier, T0)).toMatchObject({ ok: true });
    expect(await checkCompanionToken(student, verifier, T0 + 2 * DAY)).toEqual({ ok: false, reason: "expired" });
  });

  it("treats a verifier that throws as a bad signature", async () => {
    const broken: SignatureVerifier = () => Promise.reject(new Error("no plugin"));
    expect(await checkCompanionToken(lifetime(), broken, T0)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("matches the shipped public key the iPhone checks with natively", () => {
    // ios/App/App/LicensePlugin.swift uses the last 32 bytes of this SPKI.
    const spki = "MCowBQYDK2VwAyEAg/F/SrMCdmyr4xlr16viMJPRd2UGV2L833xMM4pUjAs=";
    const der = Buffer.from(spki, "base64");
    expect(der.length).toBe(44);
    const jwk = createPublicKey({ key: der, format: "der", type: "spki" }).export({ format: "jwk" });
    expect(Buffer.from(jwk.x!, "base64url")).toEqual(der.subarray(12));
  });
});

describe("deciding access on the phone", () => {
  const ok = { ok: true as const, payload: { id: "lic-1", type: "lifetime", machineId: "m" } };
  const none = { ok: false as const, reason: "missing" as const };
  const keyed = (patch: Partial<PhoneLicenseState> = {}): PhoneLicenseState => ({
    ...EMPTY_LICENSE_STATE,
    token: "t",
    from: "desktop",
    checkedAt: T0,
    ...patch,
  });

  it("starts a 7-day trial on first open and locks after it", () => {
    const first = decideAccess(EMPTY_LICENSE_STATE, none, T0);
    expect(first.access).toEqual({ full: true, source: "trial", trialDaysLeft: 7 });
    expect(first.state.trialStartedAt).toBe(T0);
    expect(decideAccess(first.state, none, T0 + 6.5 * DAY).access).toMatchObject({ full: true, trialDaysLeft: 1 });
    expect(decideAccess(first.state, none, T0 + 7 * DAY).access).toEqual({
      full: false,
      source: "none",
      reason: "trial_ended",
    });
  });

  it("doesn't let moving the clock back stretch the trial", () => {
    const later = decideAccess(EMPTY_LICENSE_STATE, none, T0).state;
    const seen = decideAccess(later, none, T0 + 8 * DAY).state;
    expect(decideAccess(seen, none, T0 + DAY).access).toMatchObject({ full: false, reason: "clock" });
  });

  it("opens with a key, saying where it came from", () => {
    expect(decideAccess(keyed(), ok, T0).access).toEqual({ full: true, source: "desktop-link" });
    expect(decideAccess(keyed({ from: "key" }), ok, T0).access).toEqual({ full: true, source: "license" });
  });

  it("locks a revoked key once the trial is over, and one unconfirmed for 45 days", () => {
    const old = { trialStartedAt: T0 - 30 * DAY };
    expect(decideAccess(keyed({ ...old, revokedIds: ["lic-1"] }), ok, T0).access).toMatchObject({
      full: false,
      reason: "revoked",
    });
    expect(decideAccess(keyed({ ...old, checkedAt: T0 - (CONFIRM_DAYS + 1) * DAY }), ok, T0).access).toMatchObject({
      full: false,
      reason: "unconfirmed",
    });
    expect(decideAccess(keyed({ ...old, checkedAt: T0 - (CONFIRM_DAYS - 1) * DAY }), ok, T0).access.full).toBe(true);
  });

  it("records the server's answers and asks again a day later", () => {
    const state = keyed({ checkedAt: null });
    expect(needsRecheck(state, T0)).toBe(true);
    const revoked = recordRevocation(state, "lic-1", true, T0);
    expect(revoked).toMatchObject({ revokedIds: ["lic-1"], checkedAt: T0 });
    expect(needsRecheck(revoked, T0 + DAY / 2)).toBe(false);
    expect(needsRecheck(revoked, T0 + 2 * DAY)).toBe(true);
    expect(recordRevocation(revoked, "lic-1", false, T0).revokedIds).toEqual([]);
  });

  it("reads saved state defensively", () => {
    expect(parseLicenseState(null)).toEqual(EMPTY_LICENSE_STATE);
    expect(parseLicenseState("{oops")).toEqual(EMPTY_LICENSE_STATE);
    expect(parseLicenseState(JSON.stringify({ token: 3, from: "x", revokedIds: ["a", 2], checkedAt: "no" }))).toEqual(
      { ...EMPTY_LICENSE_STATE, revokedIds: ["a"] },
    );
  });
});

describe("license links", () => {
  it("reads the key back, encoded or not", () => {
    const key = "eyJ+ab/cd==";
    expect(tokenFromLicenseLink(`meganstudy://license?token=${encodeURIComponent(key)}`)).toBe(key);
    expect(tokenFromLicenseLink(`meganstudy://license?token=${key}`)).toBe(key);
    expect(tokenFromLicenseLink("meganstudy://license")).toBeNull();
    expect(tokenFromLicenseLink("meganstudy://ai-key?token=x")).toBeNull();
  });
});
