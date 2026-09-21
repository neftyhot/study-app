/**
 * The developer's record of every key ever issued.
 *
 * Shared by the minting CLI and the license manager so both write the same
 * file in the same shape — a key minted at the command line and one minted in
 * the GUI are the same thing and belong in the same ledger.
 *
 * This file, like the signing key, is strictly local: it is gitignored and
 * excluded from packaged builds. It is a record of who has what, which is
 * nobody's business but yours.
 */
import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Where the signing key and the ledger live.
 *
 * Defaults to the working directory, which is what the CLI wants: run from the
 * repository, act on the repository's key. The packaged License Manager has no
 * meaningful working directory, so it sets this explicitly.
 */
let root = process.cwd();

export function setRoot(directory) {
  root = resolve(directory);
  return paths();
}

export function paths() {
  return {
    root,
    privateKey: resolve(root, ".license-private-key.pem"),
    licenses: resolve(root, "licenses.json"),
    revocations: resolve(root, "revocations.json"),
  };
}

export function hasPrivateKey() {
  try {
    loadPrivateKey();
    return true;
  } catch {
    return false;
  }
}

const DAY_MS = 86_400_000;

export function loadPrivateKey() {
  const { privateKey: path } = paths();

  let key;
  try {
    key = createPrivateKey(readFileSync(path));
  } catch {
    throw new Error(
      `Could not read ${path}. It is the signing key: local only, never committed, never packaged.`,
    );
  }

  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`${path} is not an Ed25519 key.`);
  }

  return key;
}

export function readLicenses() {
  try {
    const parsed = JSON.parse(readFileSync(paths().licenses, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // No ledger yet, or an unreadable one. Starting empty is right for the
    // first case; for the second, refusing to overwrite would be better —
    // see `writeLicenses`.
    return [];
  }
}

function fileExists(path) {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

export function writeLicenses(records) {
  const { licenses } = paths();

  // A corrupt ledger must not be silently replaced by an empty one: that would
  // lose the record of every key already in circulation.
  if (records.length === 0 && fileExists(licenses)) {
    const existing = readFileSync(licenses, "utf8").trim();
    if (existing && existing !== "[]") {
      throw new Error(
        `Refusing to empty ${licenses}; it is not empty and could not be parsed.`,
      );
    }
  }

  mkdirSync(dirname(licenses), { recursive: true });
  writeFileSync(licenses, `${JSON.stringify(records, null, 2)}\n`, {
    mode: 0o600,
  });
}

/**
 * Signs a payload into a token.
 *
 * The exact bytes signed are the bytes that travel, so verification never has
 * to reproduce this serialisation — `JSON.stringify` of a re-parsed object is
 * not guaranteed to give back the same bytes.
 */
export function signPayload(payload, key = loadPrivateKey()) {
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");

  return Buffer.from(
    JSON.stringify({
      payload: bytes.toString("base64"),
      signature: sign(null, bytes, key).toString("base64"),
    }),
    "utf8",
  ).toString("base64");
}

/**
 * Mints a key and records it.
 *
 * @param {{name?: string, type: "admin"|"student", days?: number, machineId?: string|null}} options
 */
export function mintLicense(options) {
  const { type } = options;
  if (type !== "admin" && type !== "student") {
    throw new Error("type must be 'admin' or 'student'.");
  }

  const issuedAt = Date.now();
  const payload = { id: randomUUID(), type, issuedAt };

  const name = typeof options.name === "string" ? options.name.trim() : "";
  if (name) payload.name = name;

  if (type === "student") {
    const days = Number(options.days ?? 14);
    if (!Number.isFinite(days) || days <= 0) {
      throw new Error("days must be a positive number for a student key.");
    }
    payload.expiresAt = issuedAt + days * DAY_MS;

    const machineId =
      typeof options.machineId === "string" ? options.machineId.trim() : "";
    if (machineId) payload.machineId = machineId;
  }

  const token = signPayload(payload);

  const record = {
    id: payload.id,
    name: name || null,
    type,
    machineId: payload.machineId ?? null,
    issuedAt,
    expiresAt: payload.expiresAt ?? null,
    token,
    status: "active",
  };

  writeLicenses([...readLicenses(), record]);

  return record;
}

export function setStatus(id, status) {
  const records = readLicenses();
  const record = records.find((item) => item.id === id);
  if (!record) return null;

  record.status = status;
  record.statusChangedAt = Date.now();
  writeLicenses(records);

  exportRevocations(records);
  return record;
}

export function deleteLicense(id) {
  const records = readLicenses();
  const remaining = records.filter((item) => item.id !== id);
  if (remaining.length === records.length) return false;

  writeLicenses(remaining);
  exportRevocations(remaining);
  return true;
}

/**
 * Writes the revoked ids out on their own.
 *
 * Nothing consumes this yet — the app has no blacklist, because a blacklist
 * baked into a build only affects people who install that build. It exists so
 * the list is ready the day it is wanted.
 */
export function exportRevocations(records = readLicenses()) {
  const revoked = records
    .filter((record) => record.status === "revoked")
    .map((record) => ({
      id: record.id,
      name: record.name,
      revokedAt: record.statusChangedAt ?? null,
    }));

  writeFileSync(
    paths().revocations,
    `${JSON.stringify({ revoked }, null, 2)}\n`,
    { mode: 0o600 },
  );

  return revoked;
}

/** Days left, or null for a key that never expires. */
export function daysLeft(record, now = Date.now()) {
  if (!record.expiresAt) return null;
  return Math.max(0, Math.ceil((record.expiresAt - now) / DAY_MS));
}
