"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { writeSetting } from "@/lib/settings";
import { SYNC_SETTINGS } from "@megan/core/sync/folder-sync";

import { isUsableFolder, readSyncStatus, runSync, type SyncStatus } from "./desktop";

export type SyncActionResult =
  | { ok: true; status: SyncStatus; received: number; skipped: number; devices: number }
  | { ok: false; status: SyncStatus; error: string };

async function round(): Promise<SyncActionResult> {
  try {
    const result = await runSync();
    const status = readSyncStatus();
    if (!result) {
      return status.folder
        ? { ok: false, status, error: "The sync folder can't be reached. Is iCloud Drive turned on?" }
        : { ok: false, status, error: "Sync is off." };
    }
    // Something arrived from another device: refresh what's on screen.
    if (result.received > 0) revalidatePath("/", "layout");
    return { ok: true, status, received: result.received, skipped: result.skipped, devices: result.devices };
  } catch {
    return { ok: false, status: readSyncStatus(), error: "Syncing didn't finish. It will try again shortly." };
  }
}

/** Starts syncing through `folder` and runs the first round. */
export async function startSyncAction(folder: string): Promise<SyncActionResult> {
  if (typeof folder !== "string" || !(await isUsableFolder(folder))) {
    return { ok: false, status: readSyncStatus(), error: "That folder can't be used. Choose another." };
  }
  writeSetting(SYNC_SETTINGS.folder, folder, db);
  const result = await round();
  // Turns on the background runner in the layout.
  revalidatePath("/", "layout");
  return result;
}

export async function syncNowAction(): Promise<SyncActionResult> {
  return round();
}

/** Stops syncing. Nothing is deleted here or in the folder. */
export async function stopSyncAction(): Promise<SyncStatus> {
  writeSetting(SYNC_SETTINGS.folder, "", db);
  writeSetting(SYNC_SETTINGS.lastSyncedAt, "", db);
  revalidatePath("/", "layout");
  return readSyncStatus();
}
