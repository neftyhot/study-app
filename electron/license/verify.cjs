/**
 * Offline license verification (docs/LICENSING_SPEC.md).
 *
 * Runs in the Electron main process, before any window is created. Written as
 * plain CommonJS with no dependencies beyond `node:crypto` so that the code
 * under test is exactly the code that ships — a verifier that is transpiled on
 * its way into the bundle is a verifier nobody has actually tested.
 *
 * Everything here is pure: the machine id, the clock, and the stored launch
 * timestamp are all passed in. That is what makes clock rollback and hardware
 * mismatch testable without a second machine or a changed system clock.
 */
const { createPublicKey, verify } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");

/** Every reason a license can be refused, so callers never match on prose. */
const REASON = {
  missing: "missing",
  malformed: "malformed",
  badSignature: "bad_signature",
  expired: "expired",
  wrongMachine: "wrong_machine",
  clockRollback: "clock_rollback",
  unknownType: "unknown_type",
  trialEnded: "trial_ended",
};

/**
 * `admin`: never expires, any machine. `student`: expires, optionally tied to
 * a machine. `lifetime`: what a purchase mints — never expires, and always
 * tied to the machine it was bought for.
 */
const TYPES = { admin: "admin", student: "student", lifetime: "lifetime" };

let cachedKey = null;

function publicKey(pem) {
  if (pem) return createPublicKey(pem);
  if (cachedKey) return cachedKey;

  cachedKey = createPublicKey(
    readFileSync(path.join(__dirname, "license-public-key.pem")),
  );
  return cachedKey;
}

/**
 * Decodes a token without trusting any of it.
 *
 * A token is base64 of `{ payload, signature }`. The payload is re-serialised
 * from the bytes that were signed rather than from the parsed object, because
 * `JSON.stringify` of a parsed object is not guaranteed to reproduce the
 * original bytes — key order, spacing and number formatting can all differ,
 * and a signature over different bytes is not the same signature.
 */
function decode(token) {
  if (typeof token !== "string" || token.trim() === "") {
    return { ok: false, reason: REASON.missing };
  }

  let outer;
  try {
    outer = JSON.parse(Buffer.from(token.trim(), "base64").toString("utf8"));
  } catch {
    return { ok: false, reason: REASON.malformed };
  }

  if (
    !outer ||
    typeof outer !== "object" ||
    typeof outer.payload !== "string" ||
    typeof outer.signature !== "string"
  ) {
    return { ok: false, reason: REASON.malformed };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(outer.payload, "base64").toString("utf8"));
  } catch {
    return { ok: false, reason: REASON.malformed };
  }

  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: REASON.malformed };
  }

  return { ok: true, payload, signedBytes: outer.payload, signature: outer.signature };
}

/**
 * Verifies a license token.
 *
 * @param {string} token base64 license token
 * @param {object} context
 * @param {string} [context.machineId] this machine's id
 * @param {number} [context.now] current time in ms
 * @param {number} [context.lastLaunch] last recorded launch time in ms
 * @param {string|Buffer} [context.publicKeyPem] override, for tests
 * @returns {{valid: boolean, reason?: string, payload?: object}}
 */
function verifyLicense(token, context = {}) {
  const now = context.now ?? Date.now();

  // Rollback is checked first and refuses everything, including admin keys:
  // a clock moved backwards invalidates every time-based check that follows,
  // so there is nothing left worth evaluating.
  if (
    typeof context.lastLaunch === "number" &&
    Number.isFinite(context.lastLaunch) &&
    now < context.lastLaunch
  ) {
    return { valid: false, reason: REASON.clockRollback };
  }

  const decoded = decode(token);
  if (!decoded.ok) return { valid: false, reason: decoded.reason };

  const { payload, signedBytes, signature } = decoded;

  let signatureOk = false;
  try {
    signatureOk = verify(
      null,
      Buffer.from(signedBytes, "base64"),
      publicKey(context.publicKeyPem),
      Buffer.from(signature, "base64"),
    );
  } catch {
    signatureOk = false;
  }

  if (!signatureOk) return { valid: false, reason: REASON.badSignature };

  if (payload.type === TYPES.admin) {
    // Admin keys bypass expiry and hardware binding by design.
    return { valid: true, payload };
  }

  if (payload.type === TYPES.lifetime) {
    // A purchased key with no machine in it would open on any computer, so
    // one is required rather than optional.
    if (typeof payload.machineId !== "string" || payload.machineId === "") {
      return { valid: false, reason: REASON.malformed, payload };
    }
    if (payload.machineId !== context.machineId) {
      return { valid: false, reason: REASON.wrongMachine, payload };
    }
    return { valid: true, payload };
  }

  if (payload.type !== TYPES.student) {
    return { valid: false, reason: REASON.unknownType, payload };
  }

  if (typeof payload.expiresAt !== "number" || now > payload.expiresAt) {
    return { valid: false, reason: REASON.expired, payload };
  }

  if (payload.machineId && payload.machineId !== context.machineId) {
    return { valid: false, reason: REASON.wrongMachine, payload };
  }

  return { valid: true, payload };
}

/** Days remaining, for the settings row. Null for a key that never expires. */
function daysRemaining(payload, now = Date.now()) {
  if (!payload || payload.type === TYPES.admin || payload.type === TYPES.lifetime) {
    return null;
  }
  if (typeof payload.expiresAt !== "number") return null;
  return Math.max(0, Math.ceil((payload.expiresAt - now) / 86_400_000));
}

/** What to tell the person in front of the screen. */
const MESSAGES = {
  [REASON.missing]: "Paste a license key to continue.",
  [REASON.malformed]: "That key is not readable. Check it was copied in full.",
  [REASON.badSignature]:
    "That key did not come from this app's publisher, or it has been altered.",
  [REASON.expired]: "That key has expired.",
  [REASON.wrongMachine]: "That key belongs to a different computer.",
  [REASON.clockRollback]:
    "This computer's clock has moved backwards. Set the date and time correctly, then reopen the app.",
  [REASON.unknownType]: "That key is of a kind this version does not support.",
  [REASON.trialEnded]:
    "Your 7-day free trial has ended. Purchase a license to keep using Study App — everything you made is still here.",
};

function messageFor(reason) {
  return MESSAGES[reason] ?? "That key could not be verified.";
}

module.exports = {
  REASON,
  TYPES,
  verifyLicense,
  daysRemaining,
  messageFor,
  decode,
};
