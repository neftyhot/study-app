/**
 * Everything the window can ask for.
 *
 * Split out of `main.js` so the same handlers back both the real window and
 * the self-test harness — a UI test that registers its own handlers would be
 * testing the harness, not the app.
 */
const path = require("node:path");

let storePromise = null;

function loadStore(isDev) {
  if (!storePromise) {
    const url = new URL(
      isDev ? "../../scripts/license-store.mjs" : "./license-store.mjs",
      `file://${path.join(__dirname, "x")}`,
    );
    storePromise = import(url.href);
  }
  return storePromise;
}

async function snapshot(isDev) {
  const api = await loadStore(isDev);

  return {
    paths: api.paths(),
    hasPrivateKey: api.hasPrivateKey(),
    isDev,
    licenses: api.readLicenses().map((record) => ({
      ...record,
      daysLeft: api.daysLeft(record),
    })),
  };
}

/**
 * @param {import("electron").IpcMain} ipcMain
 * @param {{isDev: boolean, root: string, electron: object}} context
 */
async function registerHandlers(ipcMain, context) {
  const { isDev, electron } = context;
  const api = await loadStore(isDev);
  api.setRoot(context.root);

  let root = context.root;

  ipcMain.handle("state", () => snapshot(isDev));

  ipcMain.handle("mint", async (_event, options) => {
    try {
      const record = api.mintLicense(options);
      return { ok: true, record, state: await snapshot(isDev) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("set-status", async (_event, id, status) => {
    api.setStatus(id, status);
    return snapshot(isDev);
  });

  ipcMain.handle("delete", async (_event, id) => {
    api.deleteLicense(id);
    return snapshot(isDev);
  });

  ipcMain.handle("copy", (_event, text) => {
    electron.clipboard.writeText(String(text ?? ""));
    return true;
  });

  ipcMain.handle("reveal", () => {
    electron.shell.showItemInFolder(api.paths().licenses);
    return true;
  });

  ipcMain.handle("choose-folder", async () => {
    const result = await electron.dialog.showOpenDialog({
      title: "Choose the folder holding .license-private-key.pem",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: root,
    });

    if (result.canceled || result.filePaths.length === 0) {
      return snapshot(isDev);
    }

    root = result.filePaths[0];
    api.setRoot(root);
    return snapshot(isDev);
  });
}

module.exports = { registerHandlers, snapshot, loadStore };
