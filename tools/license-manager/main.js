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
const path = require("node:path");

const isDev = !app.isPackaged;

const { registerHandlers } = require("./handlers.js");

/**
 * Where the key and ledger live.
 *
 * In development that is the repository, so this and the command line act on
 * the same files. A packaged app has no meaningful working directory, so it
 * keeps its own folder — and says which one, in the window.
 */
function defaultRoot() {
  return isDev ? process.cwd() : app.getPath("userData");
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
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
