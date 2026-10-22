/** The `app_settings` table: the same key/value store the desktop keeps. */
import type { SqlDriver } from "@megan/core/platform/types";

import { nowIso } from "./db";

export async function readSetting(db: SqlDriver, key: string): Promise<string | null> {
  const [row] = await db.all<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", [key]);
  return row?.value ?? null;
}

/** An empty value removes the setting, as on desktop. */
export async function writeSetting(db: SqlDriver, key: string, value: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) {
    await db.run("DELETE FROM app_settings WHERE key = ?", [key]);
    return;
  }
  await db.run(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [key, trimmed, nowIso()],
  );
}
