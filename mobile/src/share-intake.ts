/**
 * `.meganstudy` files arriving from outside: opened from the Files app, sent
 * by AirDrop, or passed through the share sheet ("Open in Megan Study").
 * iOS hands the app a file URL; the deck is read and imported as a copy.
 */
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Encoding, Filesystem } from "@capacitor/filesystem";

import type { SqlDriver } from "@megan/core/platform/types";
import { SHARE_EXTENSION, SHARE_MAX_BYTES } from "@megan/core/share/meganstudy";

import { importShareFile } from "./data/import";

export function isSharedDeck(url: string): boolean {
  return decodeURIComponent(url.split("?")[0]).toLowerCase().endsWith(SHARE_EXTENSION);
}

export async function importFromUrl(db: SqlDriver, url: string) {
  if (!isSharedDeck(url)) return null;
  try {
    const stat = await Filesystem.stat({ path: url }).catch(() => null);
    if (stat && stat.size > SHARE_MAX_BYTES) throw new Error("That deck is larger than 10 MB.");
    const file = await Filesystem.readFile({ path: url, encoding: Encoding.UTF8 });
    return await importShareFile(db, String(file.data));
  } catch (error) {
    window.alert(`That deck could not be opened. ${error instanceof Error ? error.message : ""}`.trim());
    return null;
  }
}

/** Calls back with each file URL opened while the app is running. */
export function listenForSharedDecks(onOpen: (url: string) => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};
  const handle = CapacitorApp.addListener("appUrlOpen", ({ url }) => onOpen(url));
  return () => void handle.then((h) => h.remove());
}

/** The URL the app was cold-launched with, if it was opened on a file. */
export async function launchUrl(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const launch = await CapacitorApp.getLaunchUrl().catch(() => undefined);
  return launch?.url ?? null;
}
