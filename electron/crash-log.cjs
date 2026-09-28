/**
 * A local crash log: `<userData>/logs/crash.log`.
 *
 * Nothing is sent anywhere. When something goes wrong, the student can open
 * the file (Settings → Advanced names it) and send it themselves.
 */
const { appendFileSync, mkdirSync, renameSync, statSync } = require("node:fs");
const path = require("node:path");

/** Past this, the log is moved to crash.old.log and a new one begun. */
const MAX_BYTES = 1024 * 1024;

function crashLogPath(userDataDir) {
  return path.join(userDataDir, "logs", "crash.log");
}

function describe(error) {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  try {
    return typeof error === "string" ? error : JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Appends one entry. Never throws: a broken log must not add a crash. */
function logCrash(userDataDir, kind, error, context = {}) {
  try {
    const file = crashLogPath(userDataDir);
    mkdirSync(path.dirname(file), { recursive: true });
    try {
      if (statSync(file).size > MAX_BYTES) {
        renameSync(file, file.replace(/\.log$/, ".old.log"));
      }
    } catch {
      // No log yet.
    }
    const header = [`[${new Date().toISOString()}] ${kind}`];
    for (const [key, value] of Object.entries(context)) header.push(`${key}=${value}`);
    appendFileSync(file, `${header.join(" ")}\n${describe(error)}\n\n`);
  } catch {
    // Nowhere left to report it.
  }
}

/**
 * Records main-process exceptions and renderer or helper crashes. The
 * exception monitor only watches, so Electron's own handling is unchanged.
 */
function installCrashLog(app, userDataDir) {
  const context = () => ({
    version: app.getVersion(),
    platform: `${process.platform}-${process.arch}`,
  });
  process.on("uncaughtExceptionMonitor", (error) =>
    logCrash(userDataDir, "uncaught exception", error, context()),
  );
  process.on("unhandledRejection", (reason) =>
    logCrash(userDataDir, "unhandled rejection", reason, context()),
  );
  app.on("render-process-gone", (_event, contents, details) => {
    if (details.reason === "clean-exit") return;
    logCrash(userDataDir, "window crashed", details.reason, {
      ...context(),
      exitCode: details.exitCode,
      url: contents.getURL().split("?")[0],
    });
  });
  app.on("child-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    logCrash(userDataDir, `${details.type} process gone`, details.reason, {
      ...context(),
      exitCode: details.exitCode,
    });
  });
}

module.exports = { crashLogPath, installCrashLog, logCrash };
