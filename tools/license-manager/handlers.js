/**
 * Everything the window can ask for.
 *
 * Split out of `main.js` so the same handlers back both the real window and
 * the self-test harness — a UI test that registers its own handlers would be
 * testing the harness, not the app.
 */
const path = require("node:path");

const { registerInsights, admin } = require("./insights.js");

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
 * Sends the Worker the whole list of revoked key ids.
 *
 * The app checks its key against that list, so a revoke here only reaches
 * people once this succeeds. The list replaces the previous one, which is how
 * Restore and Delete take a key back off it. Never throws: the ledger has
 * already changed, and the window says what went wrong with the server.
 */
async function syncRevocations(api, configDir) {
  const ids = api
    .readLicenses()
    .filter((record) => record.status === "revoked")
    .map((record) => record.id);
  try {
    if (!configDir) throw new Error("No settings folder.");
    await admin(configDir, "/admin/revocations", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    return { ok: true, revoked: ids.length };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * @param {import("electron").IpcMain} ipcMain
 * @param {{isDev: boolean, root: string, electron: object, configDir?: string, onRootChange?: (root: string) => void}} context
 */
async function registerHandlers(ipcMain, context) {
  const { isDev, electron } = context;
  registerInsights(ipcMain, context);
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

  ipcMain.handle("import", async (_event, token) => {
    try {
      const { added } = api.importLicense(token);
      return { ok: true, added, state: await snapshot(isDev) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("set-status", async (_event, id, status) => {
    api.setStatus(id, status);
    return { ...(await snapshot(isDev)), sync: await syncRevocations(api, context.configDir) };
  });

  ipcMain.handle("delete", async (_event, id) => {
    api.deleteLicense(id);
    return { ...(await snapshot(isDev)), sync: await syncRevocations(api, context.configDir) };
  });

  ipcMain.handle("sync-revocations", async () => ({
    ...(await snapshot(isDev)),
    sync: await syncRevocations(api, context.configDir),
  }));

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
    context.onRootChange?.(root);
    return snapshot(isDev);
  });
}

module.exports = { registerHandlers, snapshot, loadStore, syncRevocations };
