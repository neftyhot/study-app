import { describe, expect, it } from "vitest";

import { isSealed, needsReseal, seal, unseal, type SecretCipher } from "./secret-box";

/** Stands in for a real cipher: reversible, and obviously not plain. */
const box: SecretCipher = {
  encryptString: (plain) => Buffer.from([...plain].reverse().join(""), "utf8"),
  decryptString: (encrypted) => [...encrypted.toString("utf8")].reverse().join(""),
};

describe("secret box", () => {
  it("seals with a cipher and reads it back", () => {
    const stored = seal("sk-test-1234", { v2: box });
    expect(isSealed(stored)).toBe(true);
    expect(stored.startsWith("enc:v2:")).toBe(true);
    expect(stored).not.toContain("sk-test-1234");
    expect(unseal(stored, { v2: box })).toBe("sk-test-1234");
  });

  it("stores plain text when there is no cipher, and still reads it", () => {
    expect(seal("sk-test-1234", {})).toBe("sk-test-1234");
    expect(unseal("sk-test-1234", { v2: box })).toBe("sk-test-1234");
  });

  it("reads a sealed value as absent without a working cipher", () => {
    const stored = seal("sk-test-1234", { v2: box });
    expect(unseal(stored, {})).toBeNull();
    const broken: SecretCipher = {
      ...box,
      decryptString: () => {
        throw new Error("locked");
      },
    };
    expect(unseal(stored, { v2: broken })).toBeNull();
  });

  it("opens an older format and asks for it to be resealed", () => {
    const old = seal("sk-test-1234", { v1: box });
    expect(old.startsWith("enc:v1:")).toBe(true);
    const both = { v1: box, v2: box };
    expect(unseal(old, both)).toBe("sk-test-1234");
    expect(needsReseal(old, both)).toBe(true);
    expect(needsReseal(seal("sk-test-1234", both), both)).toBe(false);
    // Without the old cipher (macOS, no Keychain) it reads as absent.
    expect(unseal(old, { v2: box })).toBeNull();
  });
});
