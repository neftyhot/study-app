/**
 * Study Suite — License Authority.
 *
 * A separate Electron application from the student client, built separately
 * (`dist-admin/`) and never bundled with it. It holds the signing key, so it
 * exists only on the developer's machine.
 *
 * Native window rather than a local web server on purpose: a server that can
 * mint licences is reachable by anything on the machine, including a web page
 * in a browser. A window is reachable by the person sitting in front of it.
 */
const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const isDev = !app.isPackaged;

// Its own data folder, by name. Built from the same package.json as the
// student app, it would otherwise inherit that app's name — and its
// user-data folder, which is where it went looking for the signing key.
app.setName("License Manager");
app.setPath("userData", path.join(app.getPath("appData"), "License Manager"));

const { registerHandlers } = require("./handlers.js");

/** Where the folder chosen in the window is remembered between launches. */
function settingsFile() {
  return path.join(app.getPath("userData"), "authority.json");
}

function savedRoot() {
  try {
    const { root } = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    return typeof root === "string" && fs.existsSync(root) ? root : null;
  } catch {
    return null;
  }
}

function saveRoot(root) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), `${JSON.stringify({ root }, null, 2)}\n`, {
    mode: 0o600,
  });
}

/**
 * Where the key and ledger live.
 *
 * The folder last chosen with "Change folder…", so the choice survives a
 * restart — without that, a packaged app came back up pointing at its own
 * empty folder every time, with minting disabled. Failing that: the
 * repository in development, so this and the command line act on the same
 * files, or the app's own folder when packaged.
 */
function defaultRoot() {
  return savedRoot() ?? (isDev ? process.cwd() : app.getPath("userData"));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    show: false,
    title: "Study Suite - License Authority",
    backgroundColor: "#0b0b0d",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: isDev,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.loadFile(path.join(__dirname, "index.html"));

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  return window;
}

app.whenReady().then(async () => {
  await registerHandlers(ipcMain, {
    isDev,
    root: defaultRoot(),
    electron: { clipboard, dialog, shell },
    onRootChange: saveRoot,
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
