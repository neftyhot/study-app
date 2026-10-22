/**
 * Picking the folder the desktop app syncs through (see
 * packages/core/src/sync/folder-sync.ts). The app reads and writes the folder
 * itself; this only finds it: iCloud Drive in one click on a Mac, or any
 * folder the student chooses (Dropbox, OneDrive, Google Drive…).
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const FOLDER_NAME = "Megan Study Sync";

/** iCloud Drive's local folder on a Mac, if it is turned on. */
function iCloudDrive() {
  if (process.platform !== "darwin") return null;
  const drive = path.join(os.homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs");
  try {
    return fs.statSync(drive).isDirectory() ? drive : null;
  } catch {
    return null;
  }
}

function registerSyncFolder({ ipcMain, dialog, fromApp, getWindows }) {
  ipcMain.handle("sync:icloud-available", (event) => {
    if (!fromApp(event)) return false;
    return iCloudDrive() !== null;
  });

  // Makes "Megan Study Sync" in iCloud Drive (or reuses it) and returns its path.
  ipcMain.handle("sync:use-icloud", (event) => {
    if (!fromApp(event)) return null;
    const drive = iCloudDrive();
    if (!drive) return null;
    const folder = path.join(drive, FOLDER_NAME);
    try {
      fs.mkdirSync(folder, { recursive: true });
      return folder;
    } catch {
      return null;
    }
  });

  ipcMain.handle("sync:pick-folder", async (event) => {
    if (!fromApp(event)) return null;
    const [window] = getWindows();
    const options = {
      title: "Choose a folder to sync through",
      buttonLabel: "Sync here",
      defaultPath: iCloudDrive() ?? os.homedir(),
      properties: ["openDirectory", "createDirectory"],
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  });
}

module.exports = { registerSyncFolder };
