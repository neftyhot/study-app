/**
 * In-app updates on iPhone and iPad: a newer version of the web app is
 * downloaded from the app's own GitHub releases and swapped in on the next
 * restart, without Xcode. Changes to native code (new plugins, Info.plist)
 * still need a build from Xcode; the manifest says which, and such an
 * update is not installed.
 *
 * Nothing is sent anywhere but GitHub, and nothing about the student: the
 * request is the same for everyone. Capgo's own stats are off in
 * capacitor.config.ts.
 */
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { CapacitorUpdater } from "@capgo/capacitor-updater";

import { version as webVersion } from "../../package.json";
import { decide, parseManifest, pickRelease, RELEASES_API, type Release } from "../lib/update-check";

export type UpdateState =
  | { kind: "unsupported" }
  | { kind: "current"; version: string }
  | { kind: "needs-reinstall"; version: string }
  | { kind: "ready"; version: string; bundleId: string }
  | { kind: "error"; message: string };

export const supported = () => Capacitor.isNativePlatform();

/**
 * Tells the updater this version started properly. Without it, a downloaded
 * version that crashes on launch is rolled back by itself.
 */
export async function markStarted() {
  if (!supported()) return;
  await CapacitorUpdater.notifyAppReady().catch(() => undefined);
}

async function getJson(url: string): Promise<unknown> {
  const response = await CapacitorHttp.get({
    url,
    headers: { Accept: "application/vnd.github+json" },
    responseType: "json",
    connectTimeout: 15000,
    readTimeout: 20000,
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`GitHub answered ${response.status}`);
  return typeof response.data === "string" ? JSON.parse(response.data) : response.data;
}

let inFlight: Promise<UpdateState> | null = null;

/** Looks for a newer version and, if there is one, downloads it ready for the next restart. */
export function checkForUpdate(): Promise<UpdateState> {
  if (!supported()) return Promise.resolve({ kind: "unsupported" });
  inFlight ??= run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<UpdateState> {
  try {
    const { native, bundle } = await CapacitorUpdater.current();
    // The built-in web app reports "builtin"; a downloaded one its own version.
    const running = bundle.version && bundle.version !== "builtin" ? bundle.version : webVersion;

    const picked = pickRelease((await getJson(RELEASES_API)) as Release[]);
    if (!picked) return { kind: "current", version: running };
    const manifest = parseManifest(await getJson(picked.manifestUrl));
    if (!manifest) return { kind: "error", message: "That update's description was not valid, so it was skipped." };

    const decision = decide(manifest, running, native);
    if (decision.kind === "none") return { kind: "current", version: running };
    if (decision.kind === "needs-reinstall") return decision;

    // Already downloaded on an earlier check?
    const { bundles } = await CapacitorUpdater.list();
    let ready = bundles.find((b) => b.version === manifest.version && b.status !== "error");
    if (!ready) {
      ready = await CapacitorUpdater.download({
        url: manifest.url,
        version: manifest.version,
        checksum: manifest.sha256,
      });
    }
    if (ready.checksum && ready.checksum.toLowerCase() !== manifest.sha256) {
      await CapacitorUpdater.delete({ id: ready.id }).catch(() => undefined);
      return { kind: "error", message: "The download did not match, so it was not installed." };
    }
    // Used on the next launch even if the student never taps Restart.
    await CapacitorUpdater.next({ id: ready.id });
    return { kind: "ready", version: manifest.version, bundleId: ready.id };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

/** Restarts into the downloaded version now. */
export async function restartIntoUpdate(bundleId: string) {
  await CapacitorUpdater.set({ id: bundleId });
}

/** The running web app's version, for Settings. */
export async function runningVersion(): Promise<string> {
  if (!supported()) return webVersion;
  try {
    const { bundle } = await CapacitorUpdater.current();
    return bundle.version && bundle.version !== "builtin" ? bundle.version : webVersion;
  } catch {
    return webVersion;
  }
}
