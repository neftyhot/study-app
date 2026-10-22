/**
 * `.meganstudy` files opened from Finder or Explorer.
 *
 * macOS hands the path to a running app through `open-file`, which can fire
 * before the window exists; Windows starts a second copy of the app with the
 * path in its arguments, which the first copy is told about and the second
 * one quits. Either way the path is queued here until the window asks.
 *
 * The window is only ever given the file's text, never a path, and only for a
 * file with this extension and a sane size. Turning it into a deck happens on
 * the server through the same check as a file picked by hand.
 *
 * The other direction, "Send to my iPhone/iPad": the window hands over a
 * deck's text and a name, it is written to a private temporary folder, and
 * macOS's share menu offers AirDrop (and Messages, Mail, Notes). Where there
 * is no share menu the student saves it instead and moves it over by hand.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const EXTENSION = ".meganstudy";
/** Matches SHARE_MAX_BYTES in src/lib/share/meganstudy.ts. */
const MAX_BYTES = 10 * 1024 * 1024;

const pending = [];
let notify = null;

function isShareFile(candidate) {
  return typeof candidate === "string" && candidate.toLowerCase().endsWith(EXTENSION);
}

function queue(filePath) {
  if (!isShareFile(filePath)) return;
  const resolved = path.resolve(filePath);
  if (pending.includes(resolved)) return;
  pending.push(resolved);
  notify?.();
}

/** Paths a launch was given on the command line (Windows, Linux). */
function queueFromArgv(argv) {
  for (const arg of argv.slice(1)) queue(arg);
}

/**
 * Registers what must exist before `ready`. Returns false when another copy
 * of the app is already running and this one should quit.
 */
function installShareFileHandlers({ app, singleInstance }) {
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    queue(filePath);
  });

  if (!singleInstance) {
    queueFromArgv(process.argv);
    return true;
  }
  if (!app.requestSingleInstanceLock()) return false;
  queueFromArgv(process.argv);
  return true;
}

/** A name safe to write: no folders, always this extension. */
function outgoingName(name) {
  const base = path.basename(typeof name === "string" ? name : "").replace(/[^\w .()-]/g, "").trim();
  const stem = base.toLowerCase().endsWith(EXTENSION) ? base.slice(0, -EXTENSION.length) : base;
  return `${stem || "deck"}${EXTENSION}`;
}

/**
 * Hands a deck to the share menu. Resolves "shared" once the menu closes
 * (macOS does not say which target was picked), "saved" after the save
 * dialog, or "cancelled".
 */
async function sendShareFile({ electron, window, name, text }) {
  if (typeof text !== "string" || !text || Buffer.byteLength(text) > MAX_BYTES) {
    return { result: "error", message: "That deck is too large to send." };
  }
  const fileName = outgoingName(name);

  if (process.platform === "darwin" && electron.ShareMenu) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "megan-send-"));
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, text, "utf8");
    const menu = new electron.ShareMenu({ filePaths: [filePath] });
    await new Promise((resolve) => menu.popup({ window, callback: resolve }));
    // AirDrop copies the file before the menu reports closing; tidy up later
    // rather than race a slow transfer.
    setTimeout(() => fs.rm(dir, { recursive: true, force: true }, () => {}), 10 * 60 * 1000).unref?.();
    return { result: "shared" };
  }

  const { canceled, filePath } = await electron.dialog.showSaveDialog(window, {
    title: "Save the deck to move to your iPhone or iPad",
    defaultPath: path.join(electron.app.getPath("downloads"), fileName),
    filters: [{ name: "Megan Study deck", extensions: [EXTENSION.slice(1)] }],
  });
  if (canceled || !filePath) return { result: "cancelled" };
  fs.writeFileSync(filePath, text, "utf8");
  return { result: "saved" };
}

/** Hooks the app window up once it exists. */
function registerShareFiles({ app, ipcMain, fromApp, getWindows }) {
  const focus = () => {
    const [window] = getWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  };

  notify = () => {
    for (const window of getWindows()) window.webContents.send("share:available");
    focus();
  };

  app.on("second-instance", (_event, argv) => {
    queueFromArgv(argv);
    focus();
  });

  // Reads and empties the queue. A file that is gone or too large is
  // reported by name so the student knows why nothing happened.
  ipcMain.handle("share:take", (event) => {
    if (!fromApp(event)) return [];
    const files = pending.splice(0, pending.length);
    return files.map((filePath) => {
      const name = path.basename(filePath);
      try {
        const { size } = fs.statSync(filePath);
        if (size > MAX_BYTES) return { name, error: "That file is too large to be a deck." };
        return { name, text: fs.readFileSync(filePath, "utf8") };
      } catch {
        return { name, error: "That file couldn't be read." };
      }
    });
  });

  ipcMain.handle("share:send", async (event, request) => {
    if (!fromApp(event)) return { result: "error", message: "Not allowed." };
    const electron = require("electron");
    const window = electron.BrowserWindow.fromWebContents(event.sender) ?? getWindows()[0];
    try {
      return await sendShareFile({ electron, window, name: request?.name, text: request?.text });
    } catch {
      return { result: "error", message: "The deck couldn't be sent." };
    }
  });
}

module.exports = { installShareFileHandlers, registerShareFiles, outgoingName };
