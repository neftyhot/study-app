/**
 * Encryption for API keys at rest on macOS, without the Keychain.
 *
 * Electron's `safeStorage` keeps its key in the login Keychain. This app is
 * not signed with an Apple Developer ID, so macOS treats every update as a
 * different program and asks for the Keychain password on launch, which
 * reads as a security warning to a student. Instead, a random key is kept in
 * the app's own data folder, readable only by this user account, and values
 * are sealed with AES-256-GCM.
 *
 * Windows keeps `safeStorage` (DPAPI), which never prompts.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** @param {string} dir the app's data folder */
function loadKey(dir) {
  const file = path.join(dir, "local-secret.key");
  try {
    const key = fs.readFileSync(file);
    if (key.length === KEY_BYTES) return key;
  } catch {
    // Not made yet.
  }
  const key = crypto.randomBytes(KEY_BYTES);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, key, { mode: 0o600 });
  return key;
}

/**
 * The cipher `src/lib/secret-box.ts` expects: strings in, Buffers out.
 *
 * @param {string} dir the app's data folder
 */
function createLocalCipher(dir) {
  const key = loadKey(dir);
  return {
    /** @param {string} plain */
    encryptString(plain) {
      const iv = crypto.randomBytes(IV_BYTES);
      const box = crypto.createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([box.update(plain, "utf8"), box.final()]);
      return Buffer.concat([iv, box.getAuthTag(), body]);
    },
    /** @param {Buffer} sealed */
    decryptString(sealed) {
      const iv = sealed.subarray(0, IV_BYTES);
      const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const box = crypto.createDecipheriv("aes-256-gcm", key, iv);
      box.setAuthTag(tag);
      return Buffer.concat([
        box.update(sealed.subarray(IV_BYTES + TAG_BYTES)),
        box.final(),
      ]).toString("utf8");
    },
  };
}

module.exports = { createLocalCipher };
