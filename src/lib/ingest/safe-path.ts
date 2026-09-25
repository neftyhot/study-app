/**
 * Keeping stored paths inside the uploads root.
 *
 * A path in the database is relative to the uploads root, and some of them
 * reach the database from the browser: a card's image path is whatever the
 * card editor sends. Anything that turns one into a file on disk goes through
 * here first, so `../../.ssh/id_rsa` or `C:\Windows\win.ini` is refused rather
 * than read, written or deleted.
 *
 * No `server-only`: card validation runs this too, and is tested directly.
 */
import { isAbsolute, posix, relative, resolve, sep, win32 } from "node:path";

export class UnsafePathError extends Error {
  constructor(readonly path: string) {
    super("That file path is outside this app's uploads.");
    this.name = "UnsafePathError";
  }
}

/**
 * Whether a stored path names something strictly inside the root. `\` counts
 * as a separator on every platform, as it does when the path is opened.
 */
export function isSafeStoredPath(rawPath: string) {
  if (typeof rawPath !== "string" || rawPath.length === 0) return false;
  if (rawPath.includes("\0")) return false;

  const normalized = rawPath.replaceAll("\\", "/");
  if (posix.isAbsolute(normalized) || win32.isAbsolute(rawPath)) return false;
  return !normalized.split("/").includes("..");
}

/**
 * The absolute path for a stored one, or UnsafePathError. The prefix test is
 * belt and braces: whatever the string check missed, a resolved path that
 * `relative()` has to leave the root to reach is refused.
 */
export function resolveUnder(root: string, rawPath: string) {
  if (!isSafeStoredPath(rawPath)) throw new UnsafePathError(rawPath);

  const base = resolve(root);
  const absolute = resolve(base, rawPath.replaceAll("\\", "/"));
  const rel = relative(base, absolute);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new UnsafePathError(rawPath);
  }
  return absolute;
}
