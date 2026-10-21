/**
 * The Changelog tab: every release, with the notes students see and the
 * developer notes the app never shows.
 *
 * Read from the checkout's `src/lib/changelog.ts` rather than copied here, so
 * the tab is never a release behind. The array in that file is plain data —
 * strings and object literals, no TypeScript inside it — so it is evaluated
 * on its own in an empty context. Commits per release come from the tags.
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { findRepo, run } = require("./scaling.js");

function readChangelog(repo) {
  const source = fs.readFileSync(path.join(repo, "src/lib/changelog.ts"), "utf8");
  const start = source.indexOf("[", source.indexOf("export const CHANGELOG"));
  const end = source.lastIndexOf("];");
  if (start === -1 || end === -1) throw new Error("src/lib/changelog.ts has no CHANGELOG array.");
  const entries = vm.runInNewContext(`(${source.slice(start, end + 1)})`, {}, { timeout: 1000 });
  if (!Array.isArray(entries)) throw new Error("CHANGELOG is not an array.");
  return entries.map((entry) => ({
    version: String(entry.version),
    date: String(entry.date ?? ""),
    notes: Array.isArray(entry.notes) ? entry.notes.map(String) : [],
    dev: Array.isArray(entry.dev) ? entry.dev.map(String) : [],
  }));
}

/** Commit subjects between each tag and the one before it; unreleased work under "next". */
async function commitsByTag(repo) {
  const { stdout } = await run("git", ["tag", "--list", "v*", "--sort=v:refname"], { cwd: repo });
  const tags = stdout.split("\n").map((t) => t.trim()).filter(Boolean);
  const result = {};
  for (let i = 0; i < tags.length; i += 1) {
    const range = i === 0 ? tags[i] : `${tags[i - 1]}..${tags[i]}`;
    const log = await run("git", ["log", "--format=%s", range], { cwd: repo, allowFailure: true });
    result[tags[i].slice(1)] = log.stdout.split("\n").filter(Boolean);
  }
  if (tags.length) {
    const log = await run("git", ["log", "--format=%s", `${tags[tags.length - 1]}..HEAD`], {
      cwd: repo,
      allowFailure: true,
    });
    result.next = log.stdout.split("\n").filter(Boolean);
  }
  return result;
}

/**
 * @param {import("electron").IpcMain} ipcMain
 * @param {{getRoot?: () => string}} context
 */
function registerChangelog(ipcMain, context) {
  ipcMain.handle("changelog:get", async () => {
    try {
      const repo = findRepo([context.getRoot?.(), process.cwd(), path.join(__dirname, "..", "..")]);
      if (!repo) {
        throw new Error(
          "The study-app repository was not found. Use “Change folder…” on the Licenses tab to pick the repository folder.",
        );
      }
      const entries = readChangelog(repo);
      const commits = await commitsByTag(repo).catch(() => ({}));
      const version = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version;
      return { ok: true, data: { entries, commits, version } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

module.exports = { registerChangelog, readChangelog };
