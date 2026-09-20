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
const { app, BrowserWindow, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const isDev = !app.isPackaged;
const DEV_URL = process.env.ELECTRON_START_URL ?? "http://localhost:3000";

/** Set before anything imports the database layer. */
function configureDataDirectories() {
  const userData = app.getPath("userData");
  const dataDir = path.join(userData, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? path.join(dataDir, "study-app.db");
  process.env.UPLOADS_DIR =
    process.env.UPLOADS_DIR ?? path.join(dataDir, "uploads");

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
 * to manage rather than a child that can outlive the window.
 */
async function startServer() {
  const port = await freePort();

  process.env.PORT = String(port);
  process.env.HOSTNAME = "127.0.0.1";
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

function createWindow(url) {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 480,
    minHeight: 600,
    show: false,
    backgroundColor: "#0a0a0a",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      // The renderer is our own web app and needs no Node access.
      nodeIntegration: false,
      contextIsolation: true,
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

app.whenReady().then(async () => {
  configureDataDirectories();

  try {
    let url = DEV_URL;

    if (!isDev) {
      await migrate();
      url = await startServer();
    }

    createWindow(url);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
    });
  } catch (error) {
    const detail =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    // Logged as well as shown: a dialog is useless when the app is being run
    // from a terminal to find out why it will not start.
    console.error(detail);
    dialog.showErrorBox("Study App could not start", detail);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
