/**
 * The developer's ledger (scripts/license-store.mjs), run against a
 * throwaway signing key in a temporary folder — never the real one.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as store from "../../../scripts/license-store.mjs";

let dir: string;
let otherKeyDir: string;

function writeKey(folder: string) {
  const { privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(
    join(folder, ".license-private-key.pem"),
    privateKey.export({ type: "pkcs8", format: "pem" }),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ledger-"));
  otherKeyDir = mkdtempSync(join(tmpdir(), "ledger-other-"));
  writeKey(dir);
  writeKey(otherKeyDir);
  store.setRoot(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(otherKeyDir, { recursive: true, force: true });
});

describe("adding an existing key", () => {
  it("puts a key back on the ledger once, with what it says about itself", () => {
    const minted = store.mintLicense({ type: "lifetime", machineId: "M-1", name: "Megan" });
    rmSync(store.paths().licenses); // the ledger was lost

    const first = store.importLicense(minted.token);
    expect(first.added).toBe(true);
    expect(first.record).toMatchObject({
      id: minted.id,
      name: "Megan",
      type: "lifetime",
      machineId: "M-1",
      status: "active",
    });

    expect(store.importLicense(`  ${minted.token}\n`).added).toBe(false);
    expect(store.readLicenses()).toHaveLength(1);
  });

  it("refuses a key this signing key did not make", () => {
    store.setRoot(otherKeyDir);
    const foreign = store.mintLicense({ type: "admin", name: "Someone" });
    store.setRoot(dir);

    expect(() => store.importLicense(foreign.token)).toThrow(/not signed by this signing key/);
    expect(() => store.importLicense("nonsense")).toThrow(/not a readable license key/);
    expect(store.readLicenses()).toHaveLength(0);
  });

  it("will not mint a lifetime key that could open anywhere", () => {
    expect(() => store.mintLicense({ type: "lifetime", name: "No machine" })).toThrow(
      /needs --machine/,
    );
  });
});
