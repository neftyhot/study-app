/**
 * The developer's window onto the app in the wild: suggestions sent from
 * Settings, and usage totals from installs that opted in.
 *
 * Talks to the licensing Worker's /admin routes (workers/licensing/src/
 * insights.ts) with a bearer token. The token lives here, in the main
 * process, in a file readable only by this user — the window never sees it,
 * and its Content-Security-Policy would not let it make the request anyway.
 */
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_URL = "https://study-app-licensing.study-app-licensing.workers.dev";

function configFile(dir) {
  return path.join(dir, "insights.json");
}

function readConfig(dir) {
  try {
    const saved = JSON.parse(fs.readFileSync(configFile(dir), "utf8"));
    return { url: saved.url || DEFAULT_URL, token: saved.token || "" };
  } catch {
    return { url: DEFAULT_URL, token: "" };
  }
}

function writeConfig(dir, config) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configFile(dir), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

async function admin(dir, route, init = {}) {
  const { url, token } = readConfig(dir);
  if (!token) throw new Error("Add the admin token under Connection first.");
  const response = await fetch(`${url.replace(/\/+$/, "")}${route}`, {
    ...init,
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401) throw new Error("The Worker refused the admin token.");
  if (!response.ok) throw new Error(`The Worker answered ${response.status}.`);
  return response.json();
}

function asText(entries) {
  const blocks = entries.map((entry, i) => {
    const meta = [
      new Date(entry.receivedAt).toLocaleString(),
      entry.version ? `v${entry.version}` : null,
      entry.contact ? `from ${entry.contact}` : null,
    ].filter(Boolean);
    return `#${i + 1} · ${meta.join(" · ")}\n${entry.text}`;
  });
  return (
    `Study App feature suggestions — ${entries.length} as of ${new Date().toLocaleString()}\n\n` +
    blocks.join(`\n\n${"-".repeat(60)}\n\n`) +
    "\n"
  );
}

/**
 * @param {import("electron").IpcMain} ipcMain
 * @param {{configDir?: string, electron: {dialog: import("electron").Dialog}}} context
 */
function registerInsights(ipcMain, context) {
  const dir = context.configDir;
  const wrap = (fn) => async (...args) => {
    if (!dir) return { ok: false, error: "No settings folder." };
    try {
      return { ok: true, data: await fn(...args) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  ipcMain.handle(
    "insights:config",
    wrap(() => {
      const { url, token } = readConfig(dir);
      return { url, hasToken: Boolean(token) };
    }),
  );

  ipcMain.handle(
    "insights:set-config",
    wrap((_event, next) => {
      const current = readConfig(dir);
      writeConfig(dir, {
        url: String(next?.url || current.url).trim(),
        // Blank means "keep the one saved": the window is never shown it.
        token: String(next?.token || "").trim() || current.token,
      });
      return { saved: true };
    }),
  );

  ipcMain.handle("insights:stats", wrap(() => admin(dir, "/admin/stats")));
  ipcMain.handle("insights:feedback", wrap(() => admin(dir, "/admin/feedback")));
  ipcMain.handle(
    "insights:delete-feedback",
    wrap((_event, key) =>
      admin(dir, `/admin/feedback/${encodeURIComponent(String(key))}`, { method: "DELETE" }),
    ),
  );

  ipcMain.handle(
    "insights:export-feedback",
    wrap(async () => {
      const entries = await admin(dir, "/admin/feedback");
      const result = await context.electron.dialog.showSaveDialog({
        title: "Save suggestions",
        defaultPath: "study-app-suggestions.txt",
      });
      if (result.canceled || !result.filePath) return { saved: false };
      fs.writeFileSync(result.filePath, asText(entries));
      return { saved: true, path: result.filePath, count: entries.length };
    }),
  );
}

module.exports = { registerInsights, readConfig, writeConfig, asText, DEFAULT_URL };
