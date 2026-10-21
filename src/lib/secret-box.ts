/**
 * Encryption for API keys at rest.
 *
 * Two formats exist. `enc:v1:` is Electron's `safeStorage` (DPAPI on Windows;
 * the Keychain on macOS in builds up to 1.8). `enc:v2:` is the app's own
 * AES-256-GCM key in its data folder, used on macOS so launching the app
 * never asks for the Keychain password (electron/local-cipher.cjs).
 *
 * The Next server runs inside Electron's main process, which puts the ciphers
 * on `globalThis` before loading it. Without one (`next dev`, CLI scripts)
 * values are stored as before, in plain text; a value no cipher here can open
 * reads as absent rather than as garbage.
 */
export type SecretCipher = {
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
};

export type SecretCiphers = { v1?: SecretCipher; v2?: SecretCipher };

type Version = keyof SecretCiphers;

const PREFIXES: Record<Version, string> = { v1: "enc:v1:", v2: "enc:v2:" };

function ciphers(): SecretCiphers {
  return (globalThis as { __studyAppCiphers?: SecretCiphers }).__studyAppCiphers ?? {};
}

/** The format new values are written in: the newest one available. */
function preferred(box: SecretCiphers): Version | null {
  if (box.v2) return "v2";
  if (box.v1) return "v1";
  return null;
}

function versionOf(stored: string): Version | null {
  if (stored.startsWith(PREFIXES.v2)) return "v2";
  if (stored.startsWith(PREFIXES.v1)) return "v1";
  return null;
}

export function isSealed(stored: string): boolean {
  return versionOf(stored) !== null;
}

/** True when the value is not yet in the format new values are written in. */
export function needsReseal(stored: string, box: SecretCiphers = ciphers()): boolean {
  const target = preferred(box);
  return target !== null && versionOf(stored) !== target;
}

export function seal(plain: string, box: SecretCiphers = ciphers()): string {
  const version = preferred(box);
  if (!version || !plain) return plain;
  try {
    return PREFIXES[version] + box[version]!.encryptString(plain).toString("base64");
  } catch (error) {
    // Still saved, so the key works, but say so: it is now readable on disk.
    console.warn("Encryption failed; storing this key unencrypted.", error);
    return plain;
  }
}

export function unseal(stored: string, box: SecretCiphers = ciphers()): string | null {
  const version = versionOf(stored);
  if (!version) return stored;
  const cipher = box[version];
  if (!cipher) return null;
  try {
    return cipher.decryptString(Buffer.from(stored.slice(PREFIXES[version].length), "base64"));
  } catch {
    return null;
  }
}

export function canSeal(): boolean {
  return preferred(ciphers()) !== null;
}
