/**
 * Syncing this iPhone with the student's other devices through their chosen
 * folder (see packages/core/src/sync/folder-sync.ts). The folder itself is
 * remembered by the native plugin; its name and the last sync time are kept
 * in app_settings like the desktop does.
 */
import type { SqlDriver } from "@megan/core/platform/types";
import { SYNC_SETTINGS, syncWithFolder, type SyncFolder, type SyncResult } from "@megan/core/sync/folder-sync";

import { newId, nowIso } from "./db";
import { readSetting, writeSetting } from "./settings";

export type SyncStatus = { folder: string | null; lastSyncedAt: string | null };

export async function readSyncStatus(db: SqlDriver): Promise<SyncStatus> {
  return {
    folder: await readSetting(db, SYNC_SETTINGS.folder),
    lastSyncedAt: await readSetting(db, SYNC_SETTINGS.lastSyncedAt),
  };
}

async function deviceId(db: SqlDriver): Promise<string> {
  const saved = await readSetting(db, SYNC_SETTINGS.deviceId);
  if (saved) return saved;
  const id = `iphone-${newId()}`;
  await writeSetting(db, SYNC_SETTINGS.deviceId, id);
  return id;
}

export async function setSyncFolder(db: SqlDriver, name: string | null): Promise<void> {
  await writeSetting(db, SYNC_SETTINGS.folder, name ?? "");
  if (!name) await writeSetting(db, SYNC_SETTINGS.lastSyncedAt, "");
}

let running: Promise<SyncResult | null> | null = null;

/** One round, or null when sync is off. Overlapping calls share the round in progress. */
export function runSync(db: SqlDriver, folder: SyncFolder, deviceName = "iPhone"): Promise<SyncResult | null> {
  if (running) return running;
  running = (async () => {
    if (!(await readSetting(db, SYNC_SETTINGS.folder))) return null;
    const result = await syncWithFolder(db, folder, { id: await deviceId(db), name: deviceName });
    await writeSetting(db, SYNC_SETTINGS.lastSyncedAt, nowIso());
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}
