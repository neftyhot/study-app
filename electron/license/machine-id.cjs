/**
 * This machine's raw hardware id, the value a purchased key is bound to.
 *
 * macOS and Linux go through `node-machine-id`, unchanged, so every key
 * already issued there keeps matching. Windows is read here instead, for two
 * reasons the library cannot be configured around:
 *
 *  - it runs `REG.exe` through `cmd.exe` with no `windowsHide`, and a GUI app
 *    with no console of its own flashes a console window at the student on
 *    every launch;
 *  - it has no timeout, and it runs synchronously on the main thread.
 *
 * The value is the same one the library would return: `MachineGuid` under
 * HKLM\SOFTWARE\Microsoft\Cryptography, lowercased. Windows writes it at
 * install and keeps it across reboots and updates; only a reinstall (or a
 * sysprep'd image) changes it.
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const WINDOWS_KEY = "HKLM\\SOFTWARE\\Microsoft\\Cryptography";

/** Pulls the GUID out of `reg query` output; null if it is not there. */
function parseRegQuery(output) {
  const match = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/.exec(String(output));
  return match ? match[1].toLowerCase() : null;
}

function windowsMachineId() {
  // The 64-bit view: a 32-bit process would otherwise be redirected to
  // WOW6432Node, which has no MachineGuid. `sysnative` reaches the real
  // System32 from a 32-bit process; a 64-bit one uses System32 directly.
  const root = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
  const system =
    process.arch === "ia32" && process.env.PROCESSOR_ARCHITEW6432
      ? "Sysnative"
      : "System32";

  const output = execFileSync(
    path.win32.join(root, system, "reg.exe"),
    ["query", WINDOWS_KEY, "/v", "MachineGuid"],
    { encoding: "utf8", windowsHide: true, timeout: 5000 },
  );

  const id = parseRegQuery(output);
  if (!id) throw new Error("MachineGuid was not in the registry output.");
  return id;
}

/** Throws if the id cannot be read; the gate decides what that means. */
function readMachineId(platform = process.platform) {
  if (platform === "win32") return windowsMachineId();

  const { machineIdSync } = require("node-machine-id");
  return machineIdSync({ original: true });
}

module.exports = { readMachineId, parseRegQuery };
