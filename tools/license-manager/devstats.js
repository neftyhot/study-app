/**
 * The Codebase tab: fun numbers about Megan Study, read from its git checkout.
 *
 * Only tracked files count (`git ls-files`), so node_modules, builds and the
 * ledger never inflate anything. Lockfiles and generated migration snapshots
 * are skipped for line counts — nobody wrote those by hand.
 */
const fs = require("node:fs");
const path = require("node:path");

const { findRepo, run } = require("./scaling.js");

const REPO = "neftyhot/study-app";

const LANGUAGES = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript (React)",
  ".js": "JavaScript",
  ".cjs": "JavaScript",
  ".mjs": "JavaScript",
  ".css": "CSS",
  ".html": "HTML",
  ".md": "Markdown",
  ".sql": "SQL",
  ".yml": "YAML",
  ".yaml": "YAML",
  ".json": "JSON",
  ".toml": "TOML",
};

const SKIP = [/package-lock\.json$/, /drizzle\/meta\//, /__fixtures__\//, /\.min\.js$/];

const COMMENT = /^\s*(\/\/|\/\*|\*|<!--|#(?!!))/;
const TEST_CASE = /^\s*(it|test)(\.each\([^)]*\))?\s*\(/;
const TODO = /\b(TODO|FIXME|HACK|XXX)\b/;

async function codeStats(repo) {
  const { stdout } = await run("git", ["ls-files", "-z"], { cwd: repo });
  const files = stdout.split("\0").filter(Boolean);

  const byLanguage = {};
  let lines = 0;
  let commentLines = 0;
  let blankLines = 0;
  let testFiles = 0;
  let testCases = 0;
  let todos = 0;
  let largest = { file: "", lines: 0 };
  let longestLine = { file: "", length: 0 };
  let components = 0;
  let pages = 0;
  let apiRoutes = 0;

  for (const file of files) {
    const language = LANGUAGES[path.extname(file)];
    if (!language || SKIP.some((re) => re.test(file))) continue;

    let text;
    try {
      text = fs.readFileSync(path.join(repo, file), "utf8");
    } catch {
      continue; // Deleted but not yet staged.
    }
    const rows = text.split("\n");
    if (rows.at(-1) === "") rows.pop();

    lines += rows.length;
    byLanguage[language] = (byLanguage[language] ?? 0) + rows.length;
    if (rows.length > largest.lines) largest = { file, lines: rows.length };

    const isTest = /\.test\.[cm]?[jt]sx?$/.test(file);
    if (isTest) testFiles += 1;
    if (/^src\/components\/.*\.tsx$/.test(file)) components += 1;
    if (/(^|\/)page\.tsx$/.test(file)) pages += 1;
    if (/^src\/app\/api\/.*route\.ts$/.test(file)) apiRoutes += 1;

    const code = language !== "Markdown" && language !== "JSON";
    for (const row of rows) {
      if (!row.trim()) blankLines += 1;
      else if (code && COMMENT.test(row)) commentLines += 1;
      if (isTest && TEST_CASE.test(row)) testCases += 1;
      if (code && TODO.test(row)) todos += 1;
      if (code && row.length > longestLine.length) longestLine = { file, length: row.length };
    }
  }

  return {
    files: files.length,
    lines,
    byLanguage: Object.entries(byLanguage).sort((a, b) => b[1] - a[1]),
    commentLines,
    blankLines,
    testFiles,
    testCases,
    todos,
    largest,
    longestLine,
    components,
    pages,
    apiRoutes,
  };
}

async function gitStats(repo) {
  const git = async (...args) => (await run("git", args, { cwd: repo })).stdout.trim();

  const [count, first, last, tags, log, numstat] = await Promise.all([
    git("rev-list", "--count", "HEAD"),
    git("log", "--reverse", "--format=%at", "--max-parents=0", "HEAD"),
    git("log", "-1", "--format=%at"),
    git("tag", "--list", "v*"),
    git("log", "--format=%at|%an|%s"),
    git("log", "--numstat", "--format="),
  ]);

  const commits = log.split("\n").filter(Boolean).map((row) => {
    const [at, author, ...subject] = row.split("|");
    return { at: Number(at) * 1000, author, subject: subject.join("|") };
  });

  const hours = new Array(24).fill(0);
  const weekdays = new Array(7).fill(0);
  const days = new Map();
  for (const { at } of commits) {
    const date = new Date(at);
    hours[date.getHours()] += 1;
    weekdays[date.getDay()] += 1;
    const day = date.toDateString();
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  const busiestDay = [...days.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];

  let added = 0;
  let removed = 0;
  for (const row of numstat.split("\n")) {
    const [plus, minus, file] = row.split("\t");
    if (!file || plus === "-" || SKIP.some((re) => re.test(file))) continue;
    added += Number(plus) || 0;
    removed += Number(minus) || 0;
  }

  const firstAt = Number(first.split("\n")[0]) * 1000;
  const nightOwl = commits.filter(({ at }) => {
    const hour = new Date(at).getHours();
    return hour >= 22 || hour < 5;
  }).length;

  return {
    commits: Number(count),
    firstAt,
    lastAt: Number(last) * 1000,
    ageDays: Math.max(1, Math.ceil((Date.now() - firstAt) / 86400000)),
    activeDays: days.size,
    authors: [...new Set(commits.map((c) => c.author))],
    tags: tags.split("\n").filter(Boolean).length,
    added,
    removed,
    busiestHour: hours.indexOf(Math.max(...hours)),
    busiestWeekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
      weekdays.indexOf(Math.max(...weekdays))
    ],
    busiestDay: { day: busiestDay[0], commits: busiestDay[1] },
    nightOwl,
    fixes: commits.filter((c) => /\bfix/i.test(c.subject)).length,
  };
}

function packageStats(repo) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
  let migrations = 0;
  try {
    migrations = fs.readdirSync(path.join(repo, "drizzle")).filter((f) => f.endsWith(".sql")).length;
  } catch {
    // No migrations folder.
  }
  return {
    version: pkg.version,
    dependencies: Object.keys(pkg.dependencies ?? {}).length,
    devDependencies: Object.keys(pkg.devDependencies ?? {}).length,
    scripts: Object.keys(pkg.scripts ?? {}).length,
    migrations,
  };
}

/** Downloads across every release; optional, since it needs gh and the network. */
async function releaseStats() {
  try {
    const { stdout } = await run("gh", [
      "api", `repos/${REPO}/releases`, "--paginate",
      "--jq", ".[] | select(.draft == false) | [.tag_name, ([.assets[].download_count] | add // 0)] | @tsv",
    ]);
    const rows = stdout.trim().split("\n").filter(Boolean).map((row) => row.split("\t"));
    return {
      releases: rows.length,
      downloads: rows.reduce((sum, [, n]) => sum + Number(n), 0),
      top: rows.sort((a, b) => Number(b[1]) - Number(a[1]))[0] ?? null,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * @param {import("electron").IpcMain} ipcMain
 * @param {{getRoot?: () => string}} context
 */
function registerDevstats(ipcMain, context) {
  ipcMain.handle("devstats:get", async () => {
    try {
      const repo = findRepo([context.getRoot?.(), process.cwd(), path.join(__dirname, "..", "..")]);
      if (!repo) {
        throw new Error(
          "The study-app repository was not found. Use “Change folder…” on the Licences tab to pick the repository folder.",
        );
      }
      const [code, git, releases] = await Promise.all([codeStats(repo), gitStats(repo), releaseStats()]);
      return { ok: true, data: { repo, code, git, pkg: packageStats(repo), releases } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

module.exports = { registerDevstats, codeStats, gitStats };
