import "server-only";

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { db } from "@/db";
import { readSetting, writeSetting } from "@/lib/settings";
import { betterSqliteDriver } from "@/lib/platform/sqlite";
import {
  SYNC_FILE_SUFFIX,
  SYNC_SETTINGS,
  syncWithFolder,
  type SyncFolder,
  type SyncResult,
} from "@megan/core/sync/folder-sync";

/**
 * The desktop side of folder sync: the folder is an ordinary directory
 * (iCloud Drive, Dropbox…) that the cloud provider keeps in step.
 */
export function fsSyncFolder(dir: string): SyncFolder {
  return {
    async list() {
      const names = await fs.readdir(dir);
      // iCloud leaves ".name.json.icloud" for a file it hasn't downloaded;
      // ask for it now so it's there next round.
      for (const name of names) {
        const match = /^\.(.+\.json)\.icloud$/.exec(name);
        if (match && process.platform === "darwin") {
          execFile("brctl", ["download", path.join(dir, match[1])], () => {});
        }
      }
      return names.filter((name) => name.endsWith(SYNC_FILE_SUFFIX) && !name.startsWith("."));
    },
    async read(name) {
      try {
        return await fs.readFile(path.join(dir, name), "utf8");
      } catch {
        return null;
      }
    },
    async write(name, text) {
      // Whole file or nothing: never leave half a file for another device to read.
      const temp = path.join(dir, `.${name}.${process.pid}.tmp`);
      await fs.writeFile(temp, text, "utf8");
      await fs.rename(temp, path.join(dir, name));
    },
  };
}

export type SyncStatus = {
  folder: string | null;
  lastSyncedAt: string | null;
};

export function readSyncStatus(): SyncStatus {
  return {
    folder: readSetting(SYNC_SETTINGS.folder, db),
    lastSyncedAt: readSetting(SYNC_SETTINGS.lastSyncedAt, db),
  };
}

function deviceId(): string {
  const stored = readSetting(SYNC_SETTINGS.deviceId, db);
  if (stored) return stored;
  const id = `mac-${randomUUID()}`;
  writeSetting(SYNC_SETTINGS.deviceId, id, db);
  return id;
}

export async function isUsableFolder(dir: string): Promise<boolean> {
  if (!path.isAbsolute(dir)) return false;
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

let running: Promise<SyncResult | null> | null = null;

/** One sync round with the chosen folder; null when sync is off or the folder is gone. */
export function runSync(): Promise<SyncResult | null> {
  // Rounds never overlap; a second ask joins the one under way.
  running ??= (async () => {
    try {
      const dir = readSetting(SYNC_SETTINGS.folder, db);
      if (!dir || !(await isUsableFolder(dir))) return null;
      const name = os.hostname().replace(/\.local$/, "") || "Computer";
      const result = await syncWithFolder(betterSqliteDriver(db.$client), fsSyncFolder(dir), {
        id: deviceId(),
        name,
      });
      writeSetting(SYNC_SETTINGS.lastSyncedAt, new Date().toISOString(), db);
      return result;
    } finally {
      running = null;
    }
  })();
  return running;
}
