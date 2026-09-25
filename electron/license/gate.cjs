/**
 * The license gate: everything the main process needs to decide whether to
 * open the app or the activation screen.
 *
 * Kept separate from `main.cjs` so the decision is one small readable unit,
 * and so the pieces that touch the filesystem and the hardware id sit in front
 * of the pure verifier rather than inside it.
 */
const { readMachineId } = require("./machine-id.cjs");

const store = require("./store.cjs");
const {
  verifyLicense,
  daysRemaining,
  messageFor,
  decode,
  REASON,
} = require("./verify.cjs");

/** How long the app runs with no license before the gate locks. */
const TRIAL_DAYS = 7;
const DAY_MS = 86_400_000;

let cachedMachineId = null;

/**
 * This machine's id.
 *
 * `original: true` returns the raw platform id rather than a hash of it, which
 * is what the student copies into an order and what a key is bound to.
 */
function machineId() {
  if (cachedMachineId) return cachedMachineId;

  try {
    cachedMachineId = readMachineId();
  } catch {
    // Better to fail open on an unreadable id than to lock someone out of
    // software they paid for because of a platform quirk.
    cachedMachineId = "unavailable";
  }

  return cachedMachineId;
}

/** The id inside a key, read without checking it; null if there is none. */
function licenseId(token) {
  const decoded = decode(token);
  const id = decoded.ok ? decoded.payload?.id : null;
  return typeof id === "string" && id !== "" ? id : null;
}

/**
 * A key that verifies but that the licensing server has revoked. The list is
 * filled in by main.cjs from the server; the verifier itself stays offline.
 */
function refuseRevoked(userDataDir, result) {
  const id = result.payload?.id;
  if (!result.valid || typeof id !== "string") return result;
  if (!store.readRevoked(userDataDir).includes(id)) return result;
  return { valid: false, reason: REASON.revoked, payload: result.payload };
}

/**
 * Evaluates the stored license for this launch.
 *
 * Order matters. A recorded clock tamper is sticky: once the clock has been
 * moved backwards, restarting with the clock put back must not silently
 * restore access, because that would make the check trivially bypassable.
 */
function evaluate(userDataDir, now = Date.now()) {
  if (store.clockTampered(userDataDir)) {
    return {
      valid: false,
      reason: REASON.clockRollback,
      message: messageFor(REASON.clockRollback),
      machineId: machineId(),
    };
  }

  const token = store.readToken(userDataDir);
  const lastLaunch = store.readLastLaunch(userDataDir);

  const result = refuseRevoked(
    userDataDir,
    verifyLicense(token, { machineId: machineId(), now, lastLaunch }),
  );

  if (result.reason === REASON.clockRollback) {
    store.flagClockTamper(userDataDir, now);
  }

  // No working license: the free trial, if it has time left. A moved-back
  // clock never gets here — it would otherwise stretch the trial forever.
  if (!result.valid && result.reason !== REASON.clockRollback) {
    const startedAt = store.startTrial(userDataDir, now);
    const expiresAt = startedAt + TRIAL_DAYS * DAY_MS;

    if (now < expiresAt) {
      return {
        valid: true,
        trial: true,
        reason: null,
        message: null,
        payload: { type: "trial", expiresAt },
        daysRemaining: Math.max(1, Math.ceil((expiresAt - now) / DAY_MS)),
        machineId: machineId(),
      };
    }

    // A key that is present but wrong says why; no key at all means the
    // trial is what ran out.
    const reason =
      result.reason === REASON.missing ? REASON.trialEnded : result.reason;
    return {
      valid: false,
      trial: false,
      reason,
      message: messageFor(reason),
      payload: result.payload ?? null,
      daysRemaining: null,
      machineId: machineId(),
    };
  }

  return {
    trial: false,
    valid: result.valid,
    reason: result.reason,
    message: result.valid ? null : messageFor(result.reason),
    payload: result.payload ?? null,
    daysRemaining: result.valid ? daysRemaining(result.payload, now) : null,
    machineId: machineId(),
  };
}

/** Checks a token the student just pasted, without storing it. */
function validate(userDataDir, token, now = Date.now()) {
  const result = refuseRevoked(
    userDataDir,
    verifyLicense(token, {
      machineId: machineId(),
      now,
      lastLaunch: store.readLastLaunch(userDataDir),
    }),
  );

  return {
    valid: result.valid,
    reason: result.reason ?? null,
    message: result.valid ? null : messageFor(result.reason),
    type: result.payload?.type ?? null,
    daysRemaining: result.valid ? daysRemaining(result.payload, now) : null,
  };
}

/** Stores a token, but only one that verifies. */
function activate(userDataDir, token, now = Date.now()) {
  const result = validate(userDataDir, token, now);
  if (!result.valid) return result;

  store.saveToken(userDataDir, token.trim());
  store.recordLaunch(userDataDir, now);
  return result;
}

module.exports = {
  TRIAL_DAYS,
  machineId,
  licenseId,
  refuseRevoked,
  evaluate,
  validate,
  activate,
  store,
};
