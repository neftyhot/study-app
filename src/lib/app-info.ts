/**
 * What this build is, and where it phones home.
 *
 * The version comes from package.json, which is what electron-builder stamps
 * on the app too, so the number in Settings matches the one in Finder.
 */
import pkg from "../../package.json";

export const APP_VERSION: string = pkg.version;

/** The public GitHub repository releases are published to. */
export const RELEASES_REPO = "neftyhot/study-app";

/**
 * The Worker that delivers licences and takes suggestions. Packaged builds get
 * it from the Electron main process (see electron/main.cjs); `next dev` reads
 * it from .env.local.
 */
export function serverUrl(): string | null {
  const url = (process.env.STUDY_APP_SERVER_URL || process.env.LICENSE_SERVER_URL || "").trim();
  return url ? url.replace(/\/+$/, "") : null;
}

/** Compares dotted versions: negative when `a` is older than `b`. */
export function compareVersions(a: string, b: string): number {
  const parts = (value: string) => value.replace(/^v/, "").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
