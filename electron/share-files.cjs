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
 */
const fs = require("node:fs");
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
}

module.exports = { installShareFileHandlers, registerShareFiles };
