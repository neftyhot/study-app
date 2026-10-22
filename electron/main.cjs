// Development only: load .env.local before any other module, so nothing
// required below can read process.env before it is populated. Never in a
// packaged build: its OAuth client is compiled in, and a file dropped beside
// it must not be able to change how it behaves.
if (!require("electron").app.isPackaged) {
  try {
    process.loadEnvFile(require("node:path").resolve(__dirname, "../.env.local"));
  } catch {
    // No .env.local.
  }
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
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  shell,
  systemPreferences,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const gate = require("./license/gate.cjs");
const purchase = require("./license/purchase.cjs");
const licenseStore = require("./license/store.cjs");
const { registerGoogleAuth } = require("./google-auth.cjs");
const updater = require("./updater.cjs");
const { installSystemFetch } = require("./network.cjs");
const { backupDatabase, backupDir } = require("./backup.cjs");
const { crashLogPath, installCrashLog, logCrash } = require("./crash-log.cjs");
const { registerLectures } = require("./lectures.cjs");
const { installShareFileHandlers, registerShareFiles } = require("./share-files.cjs");
const { registerLoginItem, startReminders } = require("./reminders.cjs");
const { registerSyncFolder } = require("./sync-folder.cjs");

const isDev = !app.isPackaged;
const DEV_URL = process.env.ELECTRON_START_URL ?? "http://localhost:3000";

const APP_NAME = "Megan Study";
/** Folders earlier versions kept their data in, under the OS's app-data dir. */
const FORMER_NAMES = ["Study App"];

app.setName(APP_NAME);

// Chromium otherwise opens the login Keychain at launch for its own cookie and
// password store, which, for an app signed without an Apple Developer ID,
// asks for the Mac password after every update. Nothing the app keeps relies
// on it: API keys are sealed by electron/local-cipher.cjs instead.
if (process.platform === "darwin") app.commandLine.appendSwitch("use-mock-keychain");

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

// `.meganstudy` files opened from Finder or Explorer. One copy of the app at a
// time once installed, so a file double-clicked on Windows reaches the window
// that is already open. Not in development: `electron:dev` would otherwise
// refuse to start beside the installed app, which shares its data folder.
const isSecondCopy = !installShareFileHandlers({ app, singleInstance: app.isPackaged });
if (isSecondCopy) app.quit();

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
    : path.join(unpackedRoot(), ...parts);
}

/**
 * Where the packaged app's unpacked files live.
 *
 * The launcher code sits sealed inside `app.asar`, which Electron checks
 * against a hash on every start. The Next server, its migrations and the
 * native modules are unpacked beside it (see `asarUnpack` in package.json):
 * the server changes into its own directory and writes a cache there, and
 * native code has to load from a real file.
 */
function unpackedRoot() {
  const root = app.getAppPath();
  return root.endsWith(".asar") ? `${root}.unpacked` : root;
}

/** Applies any migrations the packaged code expects but the data lacks. */
async function migrate() {
  const Database = require("better-sqlite3");
  const { drizzle } = require("drizzle-orm/better-sqlite3");
  const { migrate: run } = require("drizzle-orm/better-sqlite3/migrator");

  const sqlite = new Database(process.env.DATABASE_URL);
  sqlite.pragma("journal_mode = WAL");

  try {
    await backupDatabase(sqlite, process.env.DATABASE_URL);
    run(drizzle(sqlite), {
      migrationsFolder: resourcePath(".next", "standalone", "drizzle"),
    });
  } catch (error) {
    // Drizzle runs each migration in a transaction, so the file is as it was;
    // say where the copies are rather than failing silently.
    dialog.showErrorBox(
      "Megan Study couldn't update its database",
      `Your study data wasn't changed. Daily copies are kept in:\n${backupDir(process.env.DATABASE_URL)}\n\n${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
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

  // API keys are sealed at rest (src/lib/secret-box.ts); the server runs in
  // this process, so it is handed the ciphers directly. macOS uses the app's
  // own key, because the Keychain asks for a password after every update of
  // an app without an Apple Developer ID. Windows and Linux keep safeStorage,
  // which never prompts there.
  if (process.platform === "darwin") {
    globalThis.__studyAppCiphers = {
      v2: require("./local-cipher.cjs").createLocalCipher(app.getPath("userData")),
    };
  } else {
    const { safeStorage } = require("electron");
    globalThis.__studyAppCiphers = safeStorage.isEncryptionAvailable()
      ? { v1: safeStorage }
      : {};
  }
  // PowerPoint slides are drawn in a hidden window (src/lib/ingest/slide-render.ts).
  globalThis.__studyAppDrawSlides = require("./slide-drawer.cjs").drawSlides;

  // A fresh secret each launch, which the server asks of every request
  // (src/proxy.ts). Only this app's own windows are given it, so another
  // program on the computer, or a web page in a browser, cannot drive the
  // server just by finding its port. Kept off process.env so child
  // processes do not inherit it.
  const launchSecret = require("node:crypto").randomBytes(32).toString("hex");
  globalThis.__studyAppLaunchSecret = launchSecret;

  const entry = resourcePath(".next", "standalone", "server.js");
  process.chdir(path.dirname(entry));
  require(entry);

  const url = `http://127.0.0.1:${port}`;
  sendLaunchSecret(url, launchSecret);
  await waitForServer(url, launchSecret);
  return url;
}

/** The header the server checks the launch secret in; see src/proxy.ts. */
const LAUNCH_SECRET_HEADER = "x-study-app-launch";

/**
 * Adds the launch secret to every request this app's windows make to its own
 * server: the app window, and the hidden one that draws slides. Nothing
 * else, including other programs on this computer, is given it.
 */
function sendLaunchSecret(url, secret) {
  const { origin } = new URL(url);
  const { session } = require("electron");
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["http://127.0.0.1/*"] },
    (details, callback) => {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(details.url).origin === origin;
      } catch {
        // Not a URL we can read; leave it alone.
      }
      callback(
        sameOrigin
          ? { requestHeaders: { ...details.requestHeaders, [LAUNCH_SECRET_HEADER]: secret } }
          : {},
      );
    },
  );
}

/** The standalone server binds asynchronously; poll until it answers. */
async function waitForServer(url, secret, attempts = 100) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, {
        method: "HEAD",
        headers: { [LAUNCH_SECRET_HEADER]: secret },
      });
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
    openOutside(target);
    return { action: "deny" };
  });

  // A plain link to another site, say one in a tutor answer, would otherwise
  // replace the app itself: send it to the browser and stay put.
  const stayHome = (event, target) => {
    if (sameOrigin(target, url)) return;
    event.preventDefault();
    openOutside(target);
  };
  window.webContents.on("will-navigate", stayHome);
  window.webContents.on("will-redirect", stayHome);

  return window;
}

/** Whether two URLs share an origin; anything unreadable does not. */
function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * Hands a link to the system browser, but only a web or mail link: a
 * file:// or custom-scheme URL could start a program instead.
 */
function openOutside(target) {
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return;
  }
  if (!["https:", "http:", "mailto:"].includes(parsed.protocol)) return;
  shell.openExternal(parsed.href).catch(() => {});
}

/**
 * Nothing in the app needs a camera, location or devices; a page that asks is
 * not one of ours. Clipboard writes (copy buttons) still work. The microphone
 * is the one exception, for recording a lecture: see `allowMicrophone`.
 */
const REFUSED_PERMISSIONS = new Set([
  "media",
  "geolocation",
  "midi",
  "midiSysex",
  "hid",
  "serial",
  "usb",
  "idle-detection",
  "display-capture",
]);

/**
 * The microphone, and only the microphone, for the app's own pages. macOS
 * then asks the student itself, the first time.
 */
function allowMicrophone(webContents, details, callback) {
  const kinds = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
  const audioOnly = kinds.length > 0 && kinds.every((kind) => kind === "audio");
  const ours = Boolean(appUrl) && sameOrigin(webContents?.getURL() ?? "", appUrl);
  if (!audioOnly || !ours) {
    callback(false);
    return;
  }
  if (process.platform !== "darwin") {
    callback(true);
    return;
  }
  systemPreferences
    .askForMediaAccess("microphone")
    .then((granted) => callback(granted))
    .catch(() => callback(false));
}

function refuseUnneededPermissions() {
  const { session } = require("electron");
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      // A link to another program (zoommtg:, file:) is refused; mail is fine.
      if (permission === "openExternal") {
        callback(String(details?.externalURL ?? "").startsWith("mailto:"));
        return;
      }
      if (permission === "media") {
        allowMicrophone(webContents, details, callback);
        return;
      }
      callback(!REFUSED_PERMISSIONS.has(permission));
    },
  );
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
    id: license.payload.id ?? null,
    type: license.payload.type,
    name: license.payload.name ?? null,
    expiresAt: license.payload.expiresAt ?? null,
    daysRemaining: license.daysRemaining,
  });
  // A bought key also goes into the sync folder, so the student's iPhone
  // opens with it (packages/core/src/license/companion.ts). Never a trial.
  const token =
    license.valid && !license.trial ? licenseStore.readToken(app.getPath("userData")) : null;
  if (token) process.env.STUDY_APP_LICENSE_TOKEN = token;
  else delete process.env.STUDY_APP_LICENSE_TOKEN;
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

  // Off unless turned on in Settings; see reminders.cjs.
  startReminders({
    app,
    Notification,
    url,
    secret: globalThis.__studyAppLaunchSecret ?? null,
    userData: app.getPath("userData"),
    showWindow: () => {
      const [window] = BrowserWindow.getAllWindows();
      if (!window) return createWindow(url);
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    },
  });
}

app.whenReady().then(async () => {
  // The copy already running has been handed this launch's files.
  if (isSecondCopy) return;
  // Before anything reaches out: lets requests through school proxies and
  // HTTPS filters that Node's own fetch cannot pass (network.cjs).
  installSystemFetch();
  refuseUnneededPermissions();
  const { userData } = configureDataDirectories();
  installCrashLog(app, userData);
  process.env.STUDY_APP_CRASH_LOG = crashLogPath(userData);

  registerGoogleAuth({
    isDev,
    appOrigin: () => (appUrl ? new URL(appUrl).origin : null),
  });

  // Only the activation window's own page, loaded from disk, may use these.
  const fromActivation = (event) => {
    const url = event.senderFrame?.url;
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === "file:" && parsed.pathname.endsWith("/activation.html");
    } catch {
      return false;
    }
  };

  ipcMain.handle("get-machine-id", (event) =>
    fromActivation(event) ? gate.machineId() : null,
  );

  ipcMain.handle("validate-license", (event, token) =>
    fromActivation(event)
      ? gate.validate(userData, token)
      : { valid: false, message: "Not allowed." },
  );

  let appLaunched = false;

  // Bought keys need an occasional answer from the licensing server (see
  // gate.cjs); with no server configured there is nothing to ask.
  const evaluateLicense = () =>
    gate.evaluate(userData, Date.now(), {
      confirmRequired: purchase.licenseServerUrl() !== null,
    });

  /** Asks whether a key is revoked, and remembers any answer. */
  async function askRevoked(id) {
    const revoked = await purchase.checkRevoked(id);
    if (revoked === null) return null;
    gate.store.recordRevocationCheck(userData);
    if (revoked) gate.store.addRevoked(userData, id);
    else gate.store.removeRevoked(userData, id);
    return revoked;
  }

  /**
   * Stores a verified key and, from the activation screen, swaps that window
   * for the app itself rather than asking the student to quit and reopen.
   */
  async function activateAndLaunch(token) {
    // Ask the server first, so a revoked key is refused here and one that was
    // restored is accepted again. Offline, the local list decides.
    const id = gate.licenseId(token);
    if (id) await askRevoked(id);

    const result = gate.activate(userData, token);
    if (!result.valid) return result;

    // A stored key still waiting on the server stays on this screen.
    const license = evaluateLicense();
    if (!license.valid) {
      return { valid: false, reason: license.reason, message: license.message };
    }
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
    if (!token) {
      // A stored key waiting on the server to confirm it: try it again.
      const stored = gate.store.readToken(userData);
      if (stored && evaluateLicense().reason === "unconfirmed") {
        return { configured, found: true, ...(await activateAndLaunch(stored)) };
      }
      return { configured, found: false };
    }

    const result = await activateAndLaunch(token);
    return { configured, found: true, ...result };
  }

  ipcMain.handle("activate-license", (event, token) => {
    if (!fromActivation(event)) return { valid: false, message: "Not allowed." };
    return activateAndLaunch(token);
  });

  /**
   * Whether the stored key has been revoked in the License Manager. If it
   * has, the key is refused and the activation screen replaces the app. The
   * database is never touched: buying or pasting a key picks up where the
   * student left off.
   */
  async function enforceRevocation() {
    const id = gate.licenseId(gate.store.readToken(userData));
    if (!id) return;

    // The key stays stored, refused by the list, so the activation screen
    // can say it was revoked rather than that a trial ended.
    if ((await askRevoked(id)) !== true) return;

    const license = evaluateLicense();
    publishLicense(license);
    if (license.valid) return;

    createActivationWindow();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.getURL().startsWith("file://")) window.close();
    }
  }

  // Why the activation screen is showing: trial over, a bad key, a clock.
  ipcMain.handle("get-gate-status", () => {
    const status = evaluateLicense();
    return {
      reason: status.valid ? null : status.reason,
      message: status.valid ? null : status.message,
      trialDays: gate.TRIAL_DAYS,
      autoDelivery: purchase.licenseServerUrl() !== null,
    };
  });

  // The renderer never builds the checkout URL; it can only ask for it opened.
  ipcMain.handle("open-purchase", async (event) => {
    if (!fromActivation(event)) return;
    await shell.openExternal(purchase.purchaseUrl(gate.machineId()));
  });

  ipcMain.handle("check-purchase", (event) => {
    if (!fromActivation(event)) return { configured: false, found: false };
    return checkPurchase();
  });

  // The same two, for the app window during the trial (see app-preload.cjs).
  const fromApp = (event) => {
    const url = event.senderFrame?.url;
    return Boolean(appUrl && url && sameOrigin(url, appUrl));
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

  // What the student is looking at, for "Ask a tutor" questions like "what
  // does this mean". Only the window that asked is captured, and only the app.
  ipcMain.handle("tutor:capture-screen", async (event) => {
    if (!fromApp(event)) return null;
    try {
      const image = await event.sender.capturePage();
      if (image.isEmpty()) return null;
      const { width } = image.getSize();
      // Wide enough to read, small enough to send quickly.
      const scaled = width > 1600 ? image.resize({ width: 1600 }) : image;
      return `data:image/jpeg;base64,${scaled.toJPEG(80).toString("base64")}`;
    } catch {
      return null;
    }
  });

  // Shared decks opened from the file manager; see share-files.cjs.
  registerShareFiles({
    app,
    ipcMain,
    fromApp,
    getWindows: () =>
      BrowserWindow.getAllWindows().filter(
        (window) =>
          !window.isDestroyed() && appUrl && sameOrigin(window.webContents.getURL(), appUrl),
      ),
  });

  // "Open at login" for review reminders; off unless the student turns it on.
  registerLoginItem({ app, ipcMain, fromApp });

  // Lecture recordings to transcripts, on this machine; see lectures.cjs.
  registerLectures({
    app,
    ipcMain,
    dialog,
    powerSaveBlocker,
    powerMonitor,
    systemPreferences,
    shell,
    fromApp,
    getWindows: () =>
      BrowserWindow.getAllWindows().filter(
        (window) =>
          !window.isDestroyed() && appUrl && sameOrigin(window.webContents.getURL(), appUrl),
      ),
  });

  // The folder decks sync through (iCloud Drive or another); see sync-folder.cjs.
  registerSyncFolder({
    ipcMain,
    dialog,
    fromApp,
    getWindows: () =>
      BrowserWindow.getAllWindows().filter(
        (window) =>
          !window.isDestroyed() && appUrl && sameOrigin(window.webContents.getURL(), appUrl),
      ),
  });

  try {
    // Near the end of the offline allowance, ask before deciding.
    const storedId = gate.licenseId(gate.store.readToken(userData));
    if (storedId && gate.confirmationDue(userData)) await askRevoked(storedId);

    const license = evaluateLicense();

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
    logCrash(userData, "could not start", error, { version: app.getVersion() });
    dialog.showErrorBox(`${APP_NAME} could not start`, detail);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
