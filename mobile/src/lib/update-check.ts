/**
 * Which in-app update to take, if any. Pure, so it is tested without a phone;
 * src/platform/updates.ts does the fetching and installing.
 *
 * iOS updates are GitHub prereleases tagged `ios-v…` with two assets: the
 * built web app as a zip and `latest-ios.json` describing it (written by
 * scripts/ios-update.mjs). Prereleases never become the desktop's "latest",
 * and the `ios-` prefix keeps them off the desktop release workflow.
 */

/** Only the app's own releases are trusted, as on the desktop. */
export const RELEASES_API = "https://api.github.com/repos/neftyhot/study-app/releases?per_page=30";
export const DOWNLOAD_PREFIX = "https://github.com/neftyhot/study-app/releases/download/";
export const TAG_PREFIX = "ios-v";
export const MANIFEST_NAME = "latest-ios.json";

export type Release = {
  tag_name: string;
  draft: boolean;
  assets: { name: string; browser_download_url: string }[];
};

export type UpdateManifest = {
  version: string;
  /** The zip of the built web app. */
  url: string;
  sha256: string;
  /** The oldest Xcode-installed app (CFBundleShortVersionString) this runs on. */
  requiresNative: string;
};

/** True when version `a` is later than `b` (same rule as electron/updater.cjs). */
export function newer(a: string, b: string): boolean {
  const parts = (v: string) =>
    String(v)
      .replace(/^v/, "")
      .split(/[.-]/)
      .map((p) => Number.parseInt(p, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

export function trustedDownload(url: string): boolean {
  return typeof url === "string" && url.startsWith(DOWNLOAD_PREFIX) && !url.includes("..");
}

/** The newest iOS release's manifest link, or null when there is none. */
export function pickRelease(releases: Release[]): { tag: string; manifestUrl: string } | null {
  let best: { tag: string; manifestUrl: string } | null = null;
  for (const release of releases) {
    if (release.draft || !release.tag_name.startsWith(TAG_PREFIX)) continue;
    const asset = release.assets.find((a) => a.name === MANIFEST_NAME);
    if (!asset || !trustedDownload(asset.browser_download_url)) continue;
    const version = release.tag_name.slice(TAG_PREFIX.length);
    if (!best || newer(version, best.tag.slice(TAG_PREFIX.length))) {
      best = { tag: release.tag_name, manifestUrl: asset.browser_download_url };
    }
  }
  return best;
}

export function parseManifest(value: unknown): UpdateManifest | null {
  if (!value || typeof value !== "object") return null;
  const m = value as Record<string, unknown>;
  const ok =
    typeof m.version === "string" &&
    /^\d+(\.\d+){0,3}$/.test(m.version) &&
    typeof m.url === "string" &&
    trustedDownload(m.url) &&
    typeof m.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(m.sha256) &&
    typeof m.requiresNative === "string";
  return ok ? (m as UpdateManifest) : null;
}

export type Decision =
  | { kind: "none" }
  | { kind: "needs-reinstall"; version: string }
  | { kind: "update"; manifest: UpdateManifest };

/** What to do with a manifest, given the running web version and the installed app's version. */
export function decide(manifest: UpdateManifest, current: string, native: string): Decision {
  if (!newer(manifest.version, current)) return { kind: "none" };
  if (newer(manifest.requiresNative, native)) return { kind: "needs-reinstall", version: manifest.version };
  return { kind: "update", manifest };
}
