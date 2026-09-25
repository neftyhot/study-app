/**
 * Drives the real License Authority window and checks a key can be minted.
 *
 *   npm run license-manager:selftest
 *
 * Loads the same page, the same preload and the same IPC handlers the app
 * uses, then fills the form and clicks Generate the way a person would. A test
 * that called the store directly would prove the store works; this proves the
 * window does.
 *
 * It works in a temporary folder with a throwaway signing key, so it never
 * touches the real ledger.
 */
const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");
const { generateKeyPairSync } = require("node:crypto");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const { registerHandlers } = require("./handlers.js");

let failures = 0;

function check(label, condition, detail = "") {
  console.log(`  ${condition ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures += 1;
}

async function main() {
  const root = mkdtempSync(path.join(tmpdir(), "authority-"));

  // A throwaway signing key: the real one is never involved in a test.
  const { privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(
    path.join(root, ".license-private-key.pem"),
    privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600 },
  );

  await registerHandlers(ipcMain, {
    isDev: true,
    root,
    electron: { clipboard, dialog, shell },
  });

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await window.loadFile(path.join(__dirname, "index.html"));
  const run = (script) => window.webContents.executeJavaScript(script, true);

  // Give the initial state() round trip a moment to render.
  await new Promise((resolve) => setTimeout(resolve, 400));

  check("window reports the temporary folder", await run(
    `document.getElementById("path-key").textContent.includes(${JSON.stringify(root)})`,
  ));
  check("signing key detected", await run(
    `document.getElementById("key-status").textContent.includes("found")`,
  ));
  check("mint button enabled", await run(
    `!document.getElementById("mint").disabled`,
  ));
  check("table starts empty", await run(
    `document.getElementById("table").hidden === true`,
  ));

  // Fill the form and click, exactly as a person would.
  await run(`
    document.getElementById("name").value = "Selftest Student";
    document.getElementById("type").value = "student";
    document.getElementById("type").dispatchEvent(new Event("change"));
    document.getElementById("days").value = "21";
    document.getElementById("machine").value = "selftest-machine-id";
    document.getElementById("mint").click();
    true;
  `);

  await new Promise((resolve) => setTimeout(resolve, 700));

  check("status says it was recorded", await run(
    `document.getElementById("mint-status").textContent.includes("recorded")`,
  ));
  check("row appears in the table", await run(
    `document.querySelectorAll("#rows tr").length === 1`,
  ));
  check("name shown", await run(
    `document.querySelector("#rows tr").textContent.includes("Selftest Student")`,
  ));
  check("machine binding shown", await run(
    `document.querySelector("#rows tr").textContent.includes("selftest-machine-id")`,
  ));
  check("countdown shown", await run(
    `document.querySelector("#rows tr").textContent.includes("21d left")`,
  ));

  // The token must verify against the public half of the throwaway key.
  const token = await run(`
    window.authority.state().then((s) => s.licenses[0].token)
  `);

  const { verifyLicense } = require("../../electron/license/verify.cjs");
  const publicKeyPem = require("node:crypto")
    .createPublicKey(privateKey)
    .export({ type: "spki", format: "pem" });

  const verified = verifyLicense(token, {
    publicKeyPem,
    machineId: "selftest-machine-id",
  });
  check("minted token verifies", verified.valid, verified.reason ?? "");

  const wrongMachine = verifyLicense(token, {
    publicKeyPem,
    machineId: "a-different-computer",
  });
  check("rejected on another machine", wrongMachine.reason === "wrong_machine");

  // Revoke through the UI.
  await run(`
    [...document.querySelectorAll("#rows button")].find((b) => b.textContent === "Revoke").click();
    true;
  `);
  await new Promise((resolve) => setTimeout(resolve, 400));

  check("row marked revoked", await run(
    `document.querySelector("#rows tr").textContent.includes("revoked")`,
  ));
  // No settings folder here, so the push to the Worker cannot happen — and
  // the window has to say so rather than imply the key is now blocked.
  check("failed server sync is shown", await run(
    `!document.getElementById("alert").hidden && document.getElementById("alert").textContent.includes("server was not updated")`,
  ));

  rmSync(root, { recursive: true, force: true });

  console.log(
    failures === 0
      ? "\nLicense Authority self-test passed.\n"
      : `\nLicense Authority self-test FAILED: ${failures} check(s).\n`,
  );

  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(() =>
  main().catch((error) => {
    console.error(error);
    app.exit(1);
  }),
);
