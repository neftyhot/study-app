/**
 * The Windows machine id (electron/license/machine-id.cjs).
 *
 * The registry itself can only be read on Windows, so this covers the part
 * that decides what a key is bound to: turning `reg query` output into the
 * same lowercase GUID `node-machine-id` returned.
 */
import { describe, expect, it } from "vitest";

/* eslint-disable @typescript-eslint/no-require-imports */
const { parseRegQuery, readMachineId } = require("../../../electron/license/machine-id.cjs");
/* eslint-enable @typescript-eslint/no-require-imports */

describe("parseRegQuery", () => {
  it("reads MachineGuid from reg.exe output", () => {
    const output = [
      "",
      "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography",
      "    MachineGuid    REG_SZ    5B1E3C2A-9F4D-4E6B-8A7C-1D2E3F4A5B6C",
      "",
      "",
    ].join("\r\n");

    expect(parseRegQuery(output)).toBe("5b1e3c2a-9f4d-4e6b-8a7c-1d2e3f4a5b6c");
  });

  it("returns null when the value is missing", () => {
    expect(parseRegQuery("ERROR: The system was unable to find the specified registry key or value.")).toBeNull();
    expect(parseRegQuery("")).toBeNull();
  });
});

describe("readMachineId", () => {
  it.skipIf(process.platform === "win32")("keeps using node-machine-id off Windows", async () => {
    const { machineIdSync } = await import("node-machine-id");
    expect(readMachineId()).toBe(machineIdSync(true));
  });
});
