/**
 * Installing an update from inside the app.
 *
 * The app is not yet signed with an Apple Developer ID, so a DMG downloaded
 * in a browser is quarantined and Gatekeeper calls the app "damaged". A file
 * downloaded here, by Node, is never quarantined — the same reason
 * scripts/install.sh uses curl — so this does what that script does: fetch
 * the latest release's DMG, copy the app out of it, and swap it in.
 *
 * The student's data lives in Application Support, not in the bundle, so it
 * is untouched. The old bundle is renamed aside rather than deleted while it
 * is running, and cleared on the next launch.
 */
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { promisify } = require("node:util");

const run = promisify(execFile);

const REPO = "neftyhot/study-app";
/** The bundle a release's DMG holds; the first is the current name. */
const APP_NAMES = ["Megan Study.app", "Study App.app"];

function newer(a, b) {
  const parts = (v) => String(v).replace(/^v/, "").split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

/** The running app's bundle: …/Megan Study.app, or its former name. */
function bundlePath(app) {
  return path.resolve(app.getPath("exe"), "..", "..", "..");
}

/** Removes what a previous update left beside the bundle. */
function cleanUpAfterUpdate(app) {
  if (!app.isPackaged || process.platform !== "darwin") return;
  for (const suffix of [".old", ".update"]) {
    fs.rmSync(`${bundlePath(app)}${suffix}`, { recursive: true, force: true });
  }
}

async function installUpdate(app) {
  if (!app.isPackaged || process.platform !== "darwin") {
    return { ok: false, error: "Updates install themselves only in the Mac app." };
  }

  const bundle = bundlePath(app);
  if (!bundle.endsWith(".app")) return { ok: false, error: "Could not find the app to update." };
  try {
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
  } catch {
    return { ok: false, error: `No permission to write to ${path.dirname(bundle)}.` };
  }

  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "MeganStudy-Updater" },
  });
  if (!response.ok) return { ok: false, error: "Could not reach GitHub." };
  const release = await response.json();

  const version = String(release.tag_name ?? "").replace(/^v/, "");
  if (!newer(version, app.getVersion())) return { ok: false, error: "You already have the latest version." };

  const assets = release.assets ?? [];
  const dmg =
    assets.find((asset) => /arm64\.dmg$/.test(asset.name)) ?? assets.find((asset) => asset.name.endsWith(".dmg"));
  if (!dmg) return { ok: false, error: "That release has no Mac download." };

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "megan-study-update-"));
  const file = path.join(work, "update.dmg");
  let mount = null;

  try {
    const download = await fetch(dmg.browser_download_url, { headers: { "user-agent": "MeganStudy-Updater" } });
    if (!download.ok || !download.body) throw new Error("The download failed.");
    await pipeline(Readable.fromWeb(download.body), fs.createWriteStream(file));

    const { stdout } = await run("hdiutil", ["attach", file, "-nobrowse", "-readonly"]);
    mount = (stdout.match(/\/Volumes\/.*$/m) ?? [])[0]?.trim() ?? null;
    if (!mount) throw new Error("Could not open the downloaded update.");

    const staged = `${bundle}.update`;
    fs.rmSync(staged, { recursive: true, force: true });
    // Swapped in at the running bundle's path, whatever it is called: the
    // Dock, Launchpad and relaunch all point there.
    const source = APP_NAMES.map((name) => path.join(mount, name)).find((candidate) => fs.existsSync(candidate));
    if (!source) throw new Error("The downloaded update has no app in it.");
    await run("ditto", [source, staged]);
    await run("xattr", ["-dr", "com.apple.quarantine", staged]).catch(() => undefined);

    const old = `${bundle}.old`;
    fs.rmSync(old, { recursive: true, force: true });
    fs.renameSync(bundle, old);
    fs.renameSync(staged, bundle);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (mount) await run("hdiutil", ["detach", mount, "-quiet"]).catch(() => undefined);
    fs.rmSync(work, { recursive: true, force: true });
  }

  // Give the window a moment to say so, then come back as the new version.
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 800);
  return { ok: true, version };
}

module.exports = { installUpdate, cleanUpAfterUpdate, newer };
