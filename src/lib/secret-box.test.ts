import { describe, expect, it } from "vitest";

import { isSealed, seal, unseal, type SecretCipher } from "./secret-box";

/** Stands in for Electron's safeStorage: reversible, and obviously not plain. */
const box: SecretCipher = {
  encryptString: (plain) => Buffer.from([...plain].reverse().join(""), "utf8"),
  decryptString: (encrypted) => [...encrypted.toString("utf8")].reverse().join(""),
};

describe("secret box", () => {
  it("seals with a cipher and reads it back", () => {
    const stored = seal("sk-test-1234", box);
    expect(isSealed(stored)).toBe(true);
    expect(stored).not.toContain("sk-test-1234");
    expect(unseal(stored, box)).toBe("sk-test-1234");
  });

  it("stores plain text when there is no cipher, and still reads it", () => {
    expect(seal("sk-test-1234", null)).toBe("sk-test-1234");
    expect(unseal("sk-test-1234", box)).toBe("sk-test-1234");
  });

  it("reads a sealed value as absent without a working cipher", () => {
    const stored = seal("sk-test-1234", box);
    expect(unseal(stored, null)).toBeNull();
    const broken: SecretCipher = {
      ...box,
      decryptString: () => {
        throw new Error("keychain locked");
      },
    };
    expect(unseal(stored, broken)).toBeNull();
  });
});
