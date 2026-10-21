/**
 * Review reminders, and "open at login". Both off until the student turns
 * them on in Settings.
 *
 * Every few minutes the main process asks the app's own server whether
 * today's reminder is due (src/app/api/reminders/route.ts decides, so the
 * rules live in one tested place) and, if so, shows one notification with a
 * count in it. Nothing about the cards is in it: it can show on a lock
 * screen. The day it was last sent is kept in a small file beside the data
 * so a relaunch doesn't send it twice.
 */
const fs = require("node:fs");
const path = require("node:path");

const CHECK_EVERY_MS = 5 * 60 * 1000;
const LAUNCH_SECRET_HEADER = "x-study-app-launch";

function readLastSent(file) {
  try {
    const { day } = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof day === "string" ? day : null;
  } catch {
    return null;
  }
}

function writeLastSent(file, day) {
  try {
    fs.writeFileSync(file, JSON.stringify({ day }));
  } catch {
    // Worst case, a second reminder the same day.
  }
}

/** Starts checking. Returns a stop function. */
function startReminders({ app, Notification, url, secret, userData, showWindow }) {
  const file = path.join(userData, "reminders.json");

  async function check() {
    if (!Notification.isSupported()) return;
    const last = readLastSent(file);
    try {
      const query = last ? `?last=${encodeURIComponent(last)}` : "";
      const response = await fetch(`${url}/api/reminders${query}`, {
        headers: secret ? { [LAUNCH_SECRET_HEADER]: secret } : {},
      });
      if (!response.ok) return;
      const answer = await response.json();
      if (!answer.remind) return;
      writeLastSent(file, answer.day);
      const notification = new Notification({ title: answer.title, body: answer.body });
      notification.on("click", () => showWindow());
      notification.show();
    } catch {
      // The server is busy or gone; the next check tries again.
    }
  }

  const first = setTimeout(check, 30 * 1000);
  const timer = setInterval(check, CHECK_EVERY_MS);
  app.on("before-quit", () => {
    clearTimeout(first);
    clearInterval(timer);
  });
}

/**
 * "Open at login". Only a packaged app registers itself: a development build
 * would register the bare Electron binary.
 */
function registerLoginItem({ app, ipcMain, fromApp }) {
  ipcMain.handle("reminders:login-item", (event) => {
    if (!fromApp(event)) return null;
    if (!app.isPackaged) return { supported: false, openAtLogin: false };
    return { supported: true, openAtLogin: app.getLoginItemSettings().openAtLogin };
  });
  ipcMain.handle("reminders:set-login-item", (event, open) => {
    if (!fromApp(event) || !app.isPackaged || typeof open !== "boolean") return null;
    app.setLoginItemSettings({ openAtLogin: open });
    return { supported: true, openAtLogin: app.getLoginItemSettings().openAtLogin };
  });
}

module.exports = { registerLoginItem, startReminders };
