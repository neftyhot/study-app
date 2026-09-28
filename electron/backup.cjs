/**
 * Daily copies of the study database, kept beside it.
 *
 * Taken at launch, before migrations run, so a bad upgrade or a corrupted file
 * costs at most a day's work. Uses SQLite's online backup, which is safe while
 * the database is open in WAL mode.
 */
const path = require("node:path");
const fs = require("node:fs");

const KEEP = 7;
const PREFIX = "study-app-";

function backupDir(dbPath) {
  return path.join(path.dirname(dbPath), "backups");
}

/** Today's name, e.g. study-app-2026-09-27.db (local date). */
function nameFor(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${PREFIX}${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.db`;
}

/** Oldest first beyond the newest `keep`; names sort by date. */
function expired(names, keep = KEEP) {
  return names
    .filter((name) => name.startsWith(PREFIX) && name.endsWith(".db"))
    .sort()
    .slice(0, Math.max(0, names.length - keep));
}

/**
 * Backs up `sqlite` (an open better-sqlite3 handle on `dbPath`) once per day.
 * Never throws: a failed backup must not stop the app from opening.
 */
async function backupDatabase(sqlite, dbPath, now = new Date()) {
  try {
    const dir = backupDir(dbPath);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, nameFor(now));
    if (fs.existsSync(target)) return null;

    // Written under a temporary name so a crash never leaves a half copy
    // that looks like a good one.
    const partial = `${target}.partial`;
    await sqlite.backup(partial);
    fs.renameSync(partial, target);

    for (const name of expired(fs.readdirSync(dir).filter((n) => n.startsWith(PREFIX) && n.endsWith(".db")))) {
      fs.rmSync(path.join(dir, name), { force: true });
    }
    return target;
  } catch (error) {
    console.warn("[backup] skipped:", error);
    return null;
  }
}

module.exports = { backupDatabase, backupDir, expired, nameFor };
