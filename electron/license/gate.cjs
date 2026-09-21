/**
 * The license gate: everything the main process needs to decide whether to
 * open the app or the activation screen.
 *
 * Kept separate from `main.cjs` so the decision is one small readable unit,
 * and so the pieces that touch the filesystem and the hardware id sit in front
 * of the pure verifier rather than inside it.
 */
const { machineIdSync } = require("node-machine-id");

const store = require("./store.cjs");
const { verifyLicense, daysRemaining, messageFor, REASON } = require("./verify.cjs");

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
    cachedMachineId = machineIdSync({ original: true });
  } catch {
    // Better to fail open on an unreadable id than to lock someone out of
    // software they paid for because of a platform quirk.
    cachedMachineId = "unavailable";
  }

  return cachedMachineId;
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

  const result = verifyLicense(token, {
    machineId: machineId(),
    now,
    lastLaunch,
  });

  if (result.reason === REASON.clockRollback) {
    store.flagClockTamper(userDataDir, now);
  }

  return {
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
  const result = verifyLicense(token, {
    machineId: machineId(),
    now,
    lastLaunch: store.readLastLaunch(userDataDir),
  });

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

module.exports = { machineId, evaluate, validate, activate, store };
