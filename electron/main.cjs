// Development only: load .env.local before any other module, so nothing
// required below can read process.env before it is populated. A packaged
// build has no such file (its OAuth client is compiled in), so a miss is fine.
try {
  process.loadEnvFile(require("node:path").resolve(__dirname, "../.env.local"));
} catch {
  // No .env.local.
}

/**
 * Electron main process.
 *
 * Wraps the Next.js app as a desktop application. Three things matter here:
 *
 *  1. **Where the data goes.** The database and uploads must live in the
 *     user's application-data directory, not next to the bundle — an app
 *     directory may be read-only, and on macOS it is replaced wholesale by an
 *     update, which would take a student's whole deck with it.
 *  2. **Migrations run before the server does**, so a fresh install and an
 *     upgraded one both start against a schema that matches the code.
 *  3. **Offline.** Nothing here reaches the network. Only card generation and
 *     typed grading call out, and only when the student asks for them.
 */
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const gate = require("./license/gate.cjs");
const purchase = require("./license/purchase.cjs");
const { registerGoogleAuth } = require("./google-auth.cjs");
const updater = require("./updater.cjs");

const isDev = !app.isPackaged;
const DEV_URL = process.env.ELECTRON_START_URL ?? "http://localhost:3000";

const APP_NAME = "Megan Study";
/** Folders earlier versions kept their data in, under the OS's app-data dir. */
const FORMER_NAMES = ["Study App"];

app.setName(APP_NAME);

/**
 * Brings data across from a folder the app used under an earlier name.
 *
 * Moved, not copied: the downloaded models alone are gigabytes, and a rename
 * on the same disk is instant and cannot run out of space half way. Entry by
 * entry, and never over something already in the new folder, so a partial
 * earlier attempt (or caches Electron made first) cannot cost any data. A
 * move that fails leaves that entry where it was, and the app reads it from
 * there instead: data that is found beats data that is tidy.
 */
function adoptFormerUserData(appData, target) {
  for (const name of FORMER_NAMES) {
    const former = path.join(appData, name);
    if (former === target || !fs.existsSync(former)) continue;

    try {
      fs.mkdirSync(target, { recursive: true });
      for (const entry of fs.readdirSync(former)) {
        const destination = path.join(target, entry);
        if (fs.existsSync(destination)) continue;
        fs.renameSync(path.join(former, entry), destination);
      }
      // Only once it is empty: anything left behind is still being read.
      if (fs.readdirSync(former).length === 0) fs.rmdirSync(former);
    } catch (error) {
      console.error(`Could not move ${former} to ${target}:`, error);
    }

    // The database is the one thing that must not be split from its
    // uploads. If it did not come across, keep using the old folder whole.
    const database = path.join("data", "study-app.db");
    if (fs.existsSync(path.join(former, database)) && !fs.existsSync(path.join(target, database))) {
      return former;
    }
  }
  return target;
}

{
  // %APPDATA%\Megan Study on Windows, ~/Library/Application Support/Megan
  // Study on macOS. Set before `ready`, so Electron's own caches follow it.
  // Only a packaged app moves anything: `electron:dev` would otherwise carry
  // off the data of the copy installed in /Applications on the same Mac.
  const appData = app.getPath("appData");
  const target = path.join(appData, APP_NAME);
  app.setPath("userData", app.isPackaged ? adoptFormerUserData(appData, target) : target);
}

if (process.platform === "win32") {
  // Must match build.appId, or the taskbar will not group the window with the
  // pinned shortcut the installer made.
  app.setAppUserModelId("app.study.desktop");
}

/** Set before anything imports the database layer. */
function configureDataDirectories() {
  // In development the web app is a separate `next dev`; both processes
  // must open the same database (.env.local was loaded at the top of file).
  if (isDev) {
    const repoRoot = path.join(__dirname, "..");

    // The same file `next dev` and `npm run db:migrate` open when
    // DATABASE_URL is unset (src/db/client.ts), resolved against the repo
    // root as they resolve it — not the per-user data directory, which
    // nothing migrates in development.
    const url = (process.env.DATABASE_URL ?? "./data/study-app.db").replace(
      /^file:/,
      "",
    );
    process.env.DATABASE_URL = path.resolve(repoRoot, url);
    fs.mkdirSync(path.dirname(process.env.DATABASE_URL), { recursive: true });
  }

  const userData = app.getPath("userData");
  const dataDir = path.join(userData, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? path.join(dataDir, "study-app.db");
  process.env.UPLOADS_DIR =
    process.env.UPLOADS_DIR ?? path.join(dataDir, "uploads");
  // Downloaded models are gigabytes; they belong with the data, not the code.
  process.env.MODELS_DIR =
    process.env.MODELS_DIR ?? path.join(dataDir, "models");

  return { userData, dataDir };
}

/**
 * Resolves a path inside the application bundle.
 *
 * `app.getAppPath()` is the packaged app root, wherever electron-builder put
 * it, which is more reliable than assembling it from `process.resourcesPath`.
 */
function resourcePath(...parts) {
  return isDev
    ? path.join(__dirname, "..", ...parts)
    : path.join(app.getAppPath(), ...parts);
}

/** Applies any migrations the packaged code expects but the data lacks. */
async function migrate() {
  const Database = require("better-sqlite3");
  const { drizzle } = require("drizzle-orm/better-sqlite3");
  const { migrate: run } = require("drizzle-orm/better-sqlite3/migrator");

  const sqlite = new Database(process.env.DATABASE_URL);
  sqlite.pragma("journal_mode = WAL");

  try {
    run(drizzle(sqlite), {
      migrationsFolder: resourcePath(".next", "standalone", "drizzle"),
    });
  } finally {
    sqlite.close();
  }
}

/** Asks the OS for a free port rather than guessing one. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = require("node:net").createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Starts the bundled Next.js server.
 *
 * Runs the standalone `server.js` in this process: it is the same server a
 * `next start` deployment runs, and keeping it in-process means one lifecycle
 * to manage rather than a child that can outlive the window. That matters most
 * on Windows, which has no process groups to signal: a child server there
 * outlives a closed app unless its whole tree is killed. In-process, quitting
 * the app is quitting the server.
 */
async function startServer() {
  const port = await freePort();

  process.env.PORT = String(port);
  process.env.HOSTNAME = "127.0.0.1";
  // The Worker URL is compiled into this file (scripts/compile-main.mjs); hand
  // it to the Next server, which sends feature suggestions there. Bracket
  // form on the left so the compile-time define leaves the name alone.
  process.env["STUDY_APP_SERVER_URL"] = process.env.LICENSE_SERVER_URL ?? "";
  process.env.NODE_ENV = "production";

  const entry = resourcePath(".next", "standalone", "server.js");
  process.chdir(path.dirname(entry));
  require(entry);

  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url);
  return url;
}

/** The standalone server binds asynchronously; poll until it answers. */
async function waitForServer(url, attempts = 100) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.status < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The application server did not start in time.");
}

/**
 * The activation screen.
 *
 * A local file loaded straight by the main process, not a page inside the web
 * app: the gate has to sit in front of the server rather than inside the thing
 * it is gating, or it is only a suggestion.
 */
function createActivationWindow() {
  const window = new BrowserWindow({
    width: 560,
    height: 720,
    resizable: false,
    show: false,
    title: APP_NAME,
    backgroundColor: "#0a0a0a",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: isDev,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.loadFile(path.join(__dirname, "activation.html"));
  return window;
}

/** Where the app window is loaded from, once it is. */
let appUrl = null;

function createWindow(url) {
  appUrl = url;
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 480,
    minHeight: 600,
    show: false,
    title: APP_NAME,
    backgroundColor: "#0a0a0a",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      // Only "Sign in with Google" crosses; see app-preload.cjs.
      preload: path.join(__dirname, "app-preload.cjs"),
      // The renderer is our own web app and needs no Node access.
      nodeIntegration: false,
      contextIsolation: true,
      // Closed in a shipped build: the app's own pages are not a debugging
      // surface for whoever is holding it.
      devTools: isDev,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.loadURL(url);

  // Anything aimed elsewhere opens in the real browser, not in the app frame.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });

  return window;
}

/**
 * Tells the web app the tier and countdown, for Settings. It is told, rather
 * than given any way to read or change the license itself. The packaged
 * server runs in this process and reads this per request, so an activation
 * mid-trial shows up without a restart.
 */
function publishLicense(license) {
  if (!license?.payload) return;
  process.env.STUDY_APP_LICENSE = JSON.stringify({
    type: license.payload.type,
    name: license.payload.name ?? null,
    expiresAt: license.payload.expiresAt ?? null,
    daysRemaining: license.daysRemaining,
  });
}

/** Starts the real app: migrate, serve, open a window. */
async function launchApp(license) {
  let url = DEV_URL;

  if (!isDev) {
    await migrate();

    publishLicense(license);
    url = await startServer();
  }

  createWindow(url);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
}

app.whenReady().then(async () => {
  const { userData } = configureDataDirectories();

  registerGoogleAuth({
    isDev,
    appOrigin: () => (appUrl ? new URL(appUrl).origin : null),
  });

  ipcMain.handle("get-machine-id", () => gate.machineId());

  ipcMain.handle("validate-license", (_event, token) =>
    gate.validate(userData, token),
  );

  let appLaunched = false;

  /**
   * Stores a verified key and, from the activation screen, swaps that window
   * for the app itself rather than asking the student to quit and reopen.
   */
  async function activateAndLaunch(token) {
    // Ask the server first, so a revoked key is refused here and one that was
    // restored is accepted again. Offline, the local list decides.
    const id = gate.licenseId(token);
    if (id) {
      const revoked = await purchase.checkRevoked(id);
      if (revoked === true) gate.store.addRevoked(userData, id);
      if (revoked === false) gate.store.removeRevoked(userData, id);
    }

    const result = gate.activate(userData, token);
    if (!result.valid) return result;

    const license = gate.evaluate(userData);
    if (appLaunched) {
      publishLicense(license);
    } else {
      appLaunched = true;
      await launchApp(license);
    }
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.webContents.getURL().startsWith("file://")) window.close();
    }
    return result;
  }

  /** Asks the licensing Worker for a key bought for this machine. */
  async function checkPurchase() {
    const { configured, token } = await purchase.fetchPurchasedLicense(
      gate.machineId(),
    );
    if (!token) return { configured, found: false };

    const result = await activateAndLaunch(token);
    return { configured, found: true, ...result };
  }

  ipcMain.handle("activate-license", (_event, token) => activateAndLaunch(token));

  /**
   * Whether the stored key has been revoked in the License Manager. If it
   * has, the key is refused and the activation screen replaces the app. The
   * database is never touched: buying or pasting a key picks up where the
   * student left off.
   */
  async function enforceRevocation() {
    const id = gate.licenseId(gate.store.readToken(userData));
    if (!id) return;

    const revoked = await purchase.checkRevoked(id);
    if (revoked !== true) return;

    // The key stays stored, refused by the list, so the activation screen
    // can say it was revoked rather than that a trial ended.
    gate.store.addRevoked(userData, id);

    const license = gate.evaluate(userData);
    publishLicense(license);
    if (license.valid) return;

    createActivationWindow();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.getURL().startsWith("file://")) window.close();
    }
  }

  // Why the activation screen is showing: trial over, a bad key, a clock.
  ipcMain.handle("get-gate-status", () => {
    const status = gate.evaluate(userData);
    return {
      reason: status.valid ? null : status.reason,
      message: status.valid ? null : status.message,
      trialDays: gate.TRIAL_DAYS,
      autoDelivery: purchase.licenseServerUrl() !== null,
    };
  });

  // The renderer never builds the checkout URL; it can only ask for it opened.
  ipcMain.handle("open-purchase", async () => {
    await shell.openExternal(purchase.purchaseUrl(gate.machineId()));
  });

  ipcMain.handle("check-purchase", () => checkPurchase());

  // The same two, for the app window during the trial (see app-preload.cjs).
  const fromApp = (event) => {
    const url = event.senderFrame?.url;
    return Boolean(appUrl && url && new URL(url).origin === new URL(appUrl).origin);
  };

  ipcMain.handle("license:purchase", async (event) => {
    if (!fromApp(event)) return;
    await shell.openExternal(purchase.purchaseUrl(gate.machineId()));
  });

  ipcMain.handle("license:check-purchase", async (event) => {
    if (!fromApp(event)) return { configured: false, found: false };
    return checkPurchase();
  });

  // Only ever installs GitHub's latest release; the page cannot name a file.
  ipcMain.handle("update:install", async (event) => {
    if (!fromApp(event)) return { ok: false, error: "Not allowed." };
    return updater.installUpdate(app);
  });
  updater.cleanUpAfterUpdate(app);

  try {
    const license = gate.evaluate(userData);

    if (!license.valid) {
      createActivationWindow();
      return;
    }

    // Recorded only once the license has passed, and only ever forwards.
    gate.store.recordLaunch(userData);

    appLaunched = true;
    await launchApp(license);

    // Bought during the trial but not activated yet (the confirmation tab was
    // closed, say): pick the key up quietly. Only ever while on the trial.
    if (license.trial) void checkPurchase().catch(() => {});

    // A key revoked since the last launch, now and every few hours after.
    const checkRevocation = () => void enforceRevocation().catch(() => {});
    checkRevocation();
    setInterval(checkRevocation, 6 * 60 * 60 * 1000).unref?.();
  } catch (error) {
    const detail =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    // Logged as well as shown: a dialog is useless when the app is being run
    // from a terminal to find out why it will not start.
    console.error(detail);
    dialog.showErrorBox(`${APP_NAME} could not start`, detail);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
