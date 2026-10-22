/**
 * The sync folder, a plugin built into the iPhone app
 * (ios/App/App/SyncFolderPlugin.swift): a folder the student picks in Files,
 * normally "Megan Study Sync" in iCloud Drive. In the browser preview there
 * is no folder, so sync stays off.
 */
import { registerPlugin } from "@capacitor/core";

import type { SyncFolder } from "@megan/core/sync/folder-sync";

type SyncFolderPlugin = {
  /** Opens Files to choose a folder. Null when the student cancels. */
  pick(): Promise<{ name: string | null }>;
  current(): Promise<{ name: string | null }>;
  list(): Promise<{ names: string[] }>;
  read(options: { name: string }): Promise<{ text: string | null }>;
  write(options: { name: string; text: string }): Promise<void>;
  clear(): Promise<void>;
};

export const SYNC_NEEDS_IPHONE = "Syncing works in the iPhone app.";

const unavailable = () => Promise.reject(new Error(SYNC_NEEDS_IPHONE));

export const syncFolderPlugin = registerPlugin<SyncFolderPlugin>("SyncFolder", {
  web: {
    pick: unavailable,
    current: () => Promise.resolve({ name: null }),
    list: unavailable,
    read: unavailable,
    write: unavailable,
    clear: () => Promise.resolve(),
  },
});

/** The chosen folder as the shared sync engine reaches it. */
export const pluginSyncFolder: SyncFolder = {
  async list() {
    return (await syncFolderPlugin.list()).names;
  },
  async read(name) {
    return (await syncFolderPlugin.read({ name })).text;
  },
  async write(name, text) {
    await syncFolderPlugin.write({ name, text });
  },
};
