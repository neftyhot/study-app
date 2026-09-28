/**
 * Encryption for API keys at rest, using the OS keychain through Electron's
 * `safeStorage` (Keychain on macOS, DPAPI on Windows).
 *
 * The Next server runs inside Electron's main process, which puts the cipher on
 * `globalThis` before loading it. Without one (`next dev`, CLI scripts) values
 * are stored as before, in plain text; an encrypted value then reads as absent
 * rather than as garbage.
 */
export type SecretCipher = {
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
};

const PREFIX = "enc:v1:";

function cipher(): SecretCipher | null {
  return (globalThis as { __studyAppCipher?: SecretCipher }).__studyAppCipher ?? null;
}

export function isSealed(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

export function seal(plain: string, box: SecretCipher | null = cipher()): string {
  if (!box || !plain) return plain;
  try {
    return PREFIX + box.encryptString(plain).toString("base64");
  } catch {
    return plain;
  }
}

export function unseal(stored: string, box: SecretCipher | null = cipher()): string | null {
  if (!isSealed(stored)) return stored;
  if (!box) return null;
  try {
    return box.decryptString(Buffer.from(stored.slice(PREFIX.length), "base64"));
  } catch {
    return null;
  }
}

export function canSeal(): boolean {
  return cipher() !== null;
}
