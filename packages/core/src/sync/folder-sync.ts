/**
 * Free syncing between the student's devices through a folder they already
 * have in the cloud — iCloud Drive on the iPhone and the Mac. No server of
 * ours ever sees a card.
 *
 * Each device writes only its own file, `<device id>.json`, holding its
 * courses, exams, objectives, cards and progress plus what it has deleted
 * (`sync_tombstones`, kept by the 0033 triggers). It reads everyone else's
 * files and merges them in: for every row, the newest edit wins, and a delete
 * wins over an edit made before it. Because no two devices ever write the
 * same file, the cloud never has to resolve a conflict.
 *
 * Pictures, slides and source files stay on the device that has them, so
 * the columns pointing at them are never sent and never overwritten.
 */
import type { SqlDriver, SqlValue } from "../platform/types";

export const SYNC_FORMAT = "megan-sync";
export const SYNC_VERSION = 1;
export const SYNC_FILE_SUFFIX = ".json";

/** Deletes older than this are forgotten; a device away longer may bring rows back. */
const TOMBSTONE_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;

type TableSpec = {
  name: string;
  /** What identifies the same row on every device. */
  key: string;
  /** The row this one belongs to; a row whose parent isn't here yet waits. */
  parent?: { column: string; table: string };
  /** Columns that point at things only this device has. */
  localOnly: string[];
};

/** In foreign-key order: parents before children. Deletes run in reverse. */
const TABLES: TableSpec[] = [
  { name: "courses", key: "id", localOnly: [] },
  { name: "exams", key: "id", parent: { column: "course_id", table: "courses" }, localOnly: [] },
  {
    name: "study_guide_objectives",
    key: "id",
    parent: { column: "exam_id", table: "exams" },
    localOnly: ["source_file_id"],
  },
  {
    name: "flashcards",
    key: "id",
    parent: { column: "exam_id", table: "exams" },
    localOnly: ["source_slide_id", "front_image_path", "back_image_path"],
  },
  {
    name: "study_progress",
    key: "flashcard_id",
    parent: { column: "flashcard_id", table: "flashcards" },
    localOnly: [],
  },
];

/** The card-order columns a fresh card's insert trigger recomputes; set back to the sender's afterwards. */
const CARD_ORDER = ["source_document_index", "source_page_number", "document_order_index"];

type Row = Record<string, SqlValue>;

export type SyncTable = { rows: Row[]; deleted: Record<string, string> };

export type SyncFile = {
  format: typeof SYNC_FORMAT;
  version: number;
  device: string;
  deviceName: string;
  writtenAt: string;
  tables: Record<string, SyncTable>;
  /**
   * The desktop's bought license key, so the student's phone opens with it
   * (packages/core/src/license/companion.ts). Optional: older files have
   * none, and older apps ignore it.
   */
  license?: string;
};

/** The folder, as each platform reaches it: Node's fs on desktop, a native plugin on iOS. */
export interface SyncFolder {
  /** File names (not paths) in the folder. */
  list(): Promise<string[]>;
  /** A file's text, or null if it can't be read right now (still downloading, say). */
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
}

export type SyncDevice = {
  id: string;
  name: string;
  /** This device's license key to share with the others; the desktop's, when bought. */
  license?: string | null;
};

export type SyncResult = {
  /** Rows added, changed or removed here from other devices. */
  received: number;
  /** Whether this device's own file was rewritten. */
  sent: boolean;
  /** Other devices whose files were read. */
  devices: number;
  /** Rows that couldn't be applied (a missing parent, say); tried again next time. */
  skipped: number;
  /** License keys other devices shared, newest file first. */
  licenses: string[];
};

/**
 * A time in milliseconds from any of the formats the apps write: SQLite's
 * `2026-10-22 10:00:00` (UTC, no zone) and JavaScript's ISO strings.
 */
export function syncTime(value: unknown): number {
  if (typeof value !== "string" || !value) return 0;
  const text = /^\d{4}-\d\d-\d\d \d\d:\d\d(:\d\d(\.\d+)?)?$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const time = Date.parse(text);
  return Number.isFinite(time) ? time : 0;
}

/** When a row last changed, as best its columns can tell. */
function rowTime(row: Row): number {
  return syncTime(row.updated_at) || syncTime(row.created_at) || syncTime(row.last_reviewed_at);
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function columnsOf(db: SqlDriver, table: string): Promise<string[]> {
  const rows = await db.all<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`);
  return rows.map((row) => row.name);
}

/** This device's rows and deletes, ready to write. */
export async function exportSync(db: SqlDriver, now = Date.now()): Promise<Record<string, SyncTable>> {
  const since = new Date(now - TOMBSTONE_LIFETIME_MS).toISOString();
  const tables: Record<string, SyncTable> = {};
  for (const table of TABLES) {
    const columns = (await columnsOf(db, table.name)).filter((column) => !table.localOnly.includes(column));
    const rows = await db.all<Row>(
      `SELECT ${columns.map(quote).join(", ")} FROM ${quote(table.name)} ORDER BY ${quote(table.key)}`,
    );
    const deleted: Record<string, string> = {};
    const gone = await db.all<{ row_key: string; deleted_at: string }>(
      "SELECT row_key, deleted_at FROM sync_tombstones WHERE table_name = ? AND deleted_at >= ? ORDER BY row_key",
      [table.name, since],
    );
    for (const row of gone) deleted[row.row_key] = row.deleted_at;
    tables[table.name] = { rows, deleted };
  }
  return tables;
}

/** Reads a device file, or null if it isn't one this version understands. */
export function parseSyncFile(text: string): SyncFile | null {
  try {
    const value = JSON.parse(text) as Partial<SyncFile>;
    if (value?.format !== SYNC_FORMAT || value.version !== SYNC_VERSION) return null;
    if (typeof value.device !== "string" || !value.tables || typeof value.tables !== "object") return null;
    return value as SyncFile;
  } catch {
    return null;
  }
}

async function exists(db: SqlDriver, table: string, column: string, value: SqlValue): Promise<boolean> {
  if (value === null || value === undefined) return false;
  const rows = await db.all(`SELECT 1 FROM ${quote(table)} WHERE ${quote(column)} = ? LIMIT 1`, [value]);
  return rows.length > 0;
}

/**
 * Merges another device's rows into this database. Run inside a
 * transaction. Returns how many rows changed and how many had to wait.
 */
export async function mergeSync(
  db: SqlDriver,
  tables: Record<string, SyncTable>,
): Promise<{ received: number; skipped: number }> {
  let received = 0;
  let skipped = 0;

  for (const table of TABLES) {
    const incoming = tables[table.name];
    if (!incoming || !Array.isArray(incoming.rows)) continue;
    const columns = new Set(await columnsOf(db, table.name));
    const local = new Map<string, number>();
    for (const row of await db.all<Row>(`SELECT * FROM ${quote(table.name)}`)) {
      local.set(String(row[table.key]), rowTime(row));
    }
    const tombstones = new Map<string, number>();
    for (const row of await db.all<{ row_key: string; deleted_at: string }>(
      "SELECT row_key, deleted_at FROM sync_tombstones WHERE table_name = ?",
      [table.name],
    )) {
      tombstones.set(row.row_key, syncTime(row.deleted_at));
    }

    for (const row of incoming.rows) {
      if (!row || typeof row !== "object") continue;
      const key = row[table.key];
      if (typeof key !== "string" || !key) continue;
      const time = rowTime(row);
      const mine = local.get(key);
      if (mine !== undefined && mine >= time) continue;
      const deletedAt = tombstones.get(key);
      if (mine === undefined && deletedAt !== undefined && deletedAt >= time) continue;
      if (table.parent && !(await exists(db, table.parent.table, "id", row[table.parent.column]))) {
        skipped += 1;
        continue;
      }

      const names = Object.keys(row).filter((name) => columns.has(name) && !table.localOnly.includes(name));
      const values = names.map((name) => {
        const value = row[name] as unknown;
        if (value === undefined || value === null) return null;
        if (typeof value === "boolean") return value ? 1 : 0;
        if (typeof value === "string" || typeof value === "number") return value;
        return JSON.stringify(value);
      });
      const updates = names.filter((name) => name !== table.key && name !== "id");
      try {
        await db.run(
          `INSERT INTO ${quote(table.name)} (${names.map(quote).join(", ")}) VALUES (${names.map(() => "?").join(", ")})
           ON CONFLICT(${quote(table.key)}) DO ${
             updates.length ? `UPDATE SET ${updates.map((name) => `${quote(name)} = excluded.${quote(name)}`).join(", ")}` : "NOTHING"
           }`,
          values,
        );
        if (table.name === "flashcards") {
          const order = CARD_ORDER.filter((name) => names.includes(name));
          if (order.length) {
            await db.run(
              `UPDATE flashcards SET ${order.map((name) => `${quote(name)} = ?`).join(", ")} WHERE id = ?`,
              [...order.map((name) => row[name] ?? null), key],
            );
          }
        }
        if (deletedAt !== undefined) {
          await db.run("DELETE FROM sync_tombstones WHERE table_name = ? AND row_key = ?", [table.name, key]);
        }
        local.set(key, time);
        received += 1;
      } catch {
        skipped += 1;
      }
    }
  }

  for (const table of [...TABLES].reverse()) {
    const deleted = tables[table.name]?.deleted;
    if (!deleted || typeof deleted !== "object") continue;
    for (const [key, when] of Object.entries(deleted)) {
      const deletedAt = syncTime(when);
      if (!deletedAt || typeof when !== "string") continue;
      const [row] = await db.all<Row>(`SELECT * FROM ${quote(table.name)} WHERE ${quote(table.key)} = ?`, [key]);
      if (row) {
        if (rowTime(row) >= deletedAt) continue;
        await db.run(`DELETE FROM ${quote(table.name)} WHERE ${quote(table.key)} = ?`, [key]);
        received += 1;
      }
      // Keep the sender's time rather than the trigger's "now", so an edit
      // made elsewhere after the delete still wins.
      await db.run(
        `INSERT INTO sync_tombstones (table_name, row_key, deleted_at) VALUES (?, ?, ?)
         ON CONFLICT(table_name, row_key) DO UPDATE SET deleted_at = excluded.deleted_at`,
        [table.name, key, when],
      );
    }
  }

  return { received, skipped };
}

/**
 * One round: take in every other device's file, then write this device's
 * own file if anything in it changed.
 */
export async function syncWithFolder(
  db: SqlDriver,
  folder: SyncFolder,
  device: SyncDevice,
  now = Date.now(),
): Promise<SyncResult> {
  const own = `${device.id}${SYNC_FILE_SUFFIX}`;
  const names = (await folder.list()).filter((name) => name.endsWith(SYNC_FILE_SUFFIX));

  // Read everything first, so the database work below never waits on the cloud.
  const others: SyncFile[] = [];
  let previous: SyncFile | null = null;
  for (const name of names) {
    const text = await folder.read(name);
    if (text === null) continue;
    const file = parseSyncFile(text);
    if (!file) continue;
    if (name === own || file.device === device.id) {
      if (name === own) previous = file;
      continue;
    }
    others.push(file);
  }

  const since = new Date(now - TOMBSTONE_LIFETIME_MS).toISOString();
  const merged = await db.transaction(async () => {
    await db.run("DELETE FROM sync_tombstones WHERE deleted_at < ?", [since]);
    let received = 0;
    let skipped = 0;
    for (const file of others) {
      const result = await mergeSync(db, file.tables);
      received += result.received;
      skipped += result.skipped;
    }
    return { received, skipped };
  });

  const tables = await exportSync(db, now);
  const license = device.license?.trim() || undefined;
  const sent =
    !previous || JSON.stringify(previous.tables) !== JSON.stringify(tables) || (previous.license || undefined) !== license;
  if (sent) {
    const file: SyncFile = {
      format: SYNC_FORMAT,
      version: SYNC_VERSION,
      device: device.id,
      deviceName: device.name,
      writtenAt: new Date(now).toISOString(),
      tables,
      ...(license ? { license } : {}),
    };
    await folder.write(own, JSON.stringify(file));
  }

  const licenses = others
    .filter((file) => typeof file.license === "string" && file.license.trim() !== "")
    .sort((a, b) => String(b.writtenAt).localeCompare(String(a.writtenAt)))
    .map((file) => file.license!.trim());

  return { ...merged, sent, devices: others.length, licenses };
}

/** The app_settings keys both apps keep sync's state under. */
export const SYNC_SETTINGS = {
  deviceId: "sync_device_id",
  folder: "sync_folder",
  lastSyncedAt: "sync_last_synced_at",
} as const;
