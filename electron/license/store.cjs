/**
 * Where the license and the launch clock live.
 *
 * `license.json` sits in the user-data directory, next to the database — not
 * in the application bundle, which is read-only and replaced by updates.
 *
 * The launch timestamp is the clock-rollback anchor. It is deliberately stored
 * alongside the license rather than in the app's SQLite database: the licence
 * gate runs before the server starts, and a check that depends on the thing it
 * is gating is not a check.
 */
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const path = require("node:path");

const FILE = "license.json";

function filePath(userDataDir) {
  return path.join(userDataDir, FILE);
}

function read(userDataDir) {
  try {
    const raw = readFileSync(filePath(userDataDir), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // No file yet, or an unreadable one. Either way there is no license.
    return {};
  }
}

function write(userDataDir, state) {
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(filePath(userDataDir), JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
}

function readToken(userDataDir) {
  const state = read(userDataDir);
  return typeof state.token === "string" ? state.token : null;
}

function saveToken(userDataDir, token) {
  write(userDataDir, { ...read(userDataDir), token });
}

function clearToken(userDataDir) {
  const state = read(userDataDir);
  delete state.token;
  write(userDataDir, state);
}

function readLastLaunch(userDataDir) {
  const value = read(userDataDir).lastLaunch;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Records this launch.
 *
 * Only ever moves forward. Writing a smaller value would let one backwards
 * clock erase the evidence of itself.
 */
function recordLaunch(userDataDir, now = Date.now()) {
  const state = read(userDataDir);
  const previous = typeof state.lastLaunch === "number" ? state.lastLaunch : 0;
  write(userDataDir, { ...state, lastLaunch: Math.max(previous, now) });
}

/** Set when rollback is detected, so the lock survives a restart. */
function flagClockTamper(userDataDir, now = Date.now()) {
  write(userDataDir, { ...read(userDataDir), clockTamperedAt: now });
}

function clockTampered(userDataDir) {
  return typeof read(userDataDir).clockTamperedAt === "number";
}

function clearClockTamper(userDataDir) {
  const state = read(userDataDir);
  delete state.clockTamperedAt;
  write(userDataDir, state);
}

/**
 * When the free trial began: the first launch with no license.
 *
 * Written once and never moved, so reopening the app does not restart the
 * clock. It lives in the same file as the license, which means deleting that
 * file starts a new trial — the same honest limit as the rest of this gate:
 * it keeps casual use honest, it does not stop someone determined.
 */
function readTrialStart(userDataDir) {
  const value = read(userDataDir).trialStartedAt;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function startTrial(userDataDir, now = Date.now()) {
  const existing = readTrialStart(userDataDir);
  if (existing !== null) return existing;
  write(userDataDir, { ...read(userDataDir), trialStartedAt: now });
  return now;
}

/**
 * Keys the licensing server has said are revoked.
 *
 * A key's signature never stops verifying, so revocation is a list kept
 * beside it. Remembered here so a revoked key stays refused offline, and so
 * pasting it back in does not reopen the app until the server says otherwise.
 */
function readRevoked(userDataDir) {
  const value = read(userDataDir).revokedIds;
  return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
}

function addRevoked(userDataDir, id) {
  const ids = readRevoked(userDataDir);
  if (ids.includes(id)) return;
  write(userDataDir, { ...read(userDataDir), revokedIds: [...ids, id] });
}

function removeRevoked(userDataDir, id) {
  const ids = readRevoked(userDataDir);
  if (!ids.includes(id)) return;
  write(userDataDir, {
    ...read(userDataDir),
    revokedIds: ids.filter((other) => other !== id),
  });
}

module.exports = {
  readRevoked,
  addRevoked,
  removeRevoked,
  readTrialStart,
  startTrial,
  filePath,
  readToken,
  saveToken,
  clearToken,
  readLastLaunch,
  recordLaunch,
  flagClockTamper,
  clockTampered,
  clearClockTamper,
};
