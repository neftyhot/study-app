/**
 * The same interfaces in a plain browser, for `npm run dev` in `mobile/`:
 * the screens can be worked on without a simulator. Nothing here ships to
 * students; the iOS build always takes `ios.ts`.
 *
 * The database is sql.js (SQLite compiled to WebAssembly, which the iOS
 * SQLite plugin already depends on), saved to localStorage after each write.
 */
import type {
  FileAccess,
  Haptics,
  Notifier,
  Platform,
  SecretStore,
  Speech,
  SqlDriver,
  SqlValue,
} from "@megan/core/platform/types";

import { developmentLicense } from "./license";
import { pickWithInput, toBase64 } from "./shared";

const DB_KEY = "megan-study:web-db";
const SECRET_PREFIX = "megan-study:secret:";

type SqlJsDatabase = {
  exec(sql: string): unknown;
  run(sql: string, params?: unknown[]): void;
  prepare(sql: string): {
    bind(params?: unknown[]): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  };
  getRowsModified(): number;
  export(): Uint8Array;
};

async function openWebDatabase(): Promise<SqlDriver> {
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
    import("sql.js"),
    import("sql.js/dist/sql-wasm.wasm?url"),
  ]);
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = readSaved();
  const db = new SQL.Database(saved ?? undefined) as unknown as SqlJsDatabase;

  let pending: ReturnType<typeof setTimeout> | undefined;
  let depth = 0;
  const persist = () => {
    if (depth > 0) return;
    clearTimeout(pending);
    pending = setTimeout(() => {
      try {
        localStorage.setItem(DB_KEY, toBase64(db.export()));
      } catch {
        // Over the browser's quota; the preview carries on in memory.
      }
    }, 150);
  };

  return {
    async exec(sql) {
      db.exec(sql);
      persist();
    },
    async run(sql, params: SqlValue[] = []) {
      db.run(sql, params);
      const changes = db.getRowsModified();
      persist();
      return { changes };
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      const statement = db.prepare(sql);
      try {
        statement.bind(params);
        const rows: Record<string, unknown>[] = [];
        while (statement.step()) rows.push(statement.getAsObject());
        return rows as T[];
      } finally {
        statement.free();
      }
    },
    async transaction<T>(work: () => Promise<T>) {
      if (depth > 0) return work();
      depth += 1;
      db.exec("BEGIN");
      try {
        const value = await work();
        db.exec("COMMIT");
        return value;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        depth -= 1;
        persist();
      }
    },
  };
}

function readSaved(): Uint8Array | null {
  try {
    const text = localStorage.getItem(DB_KEY);
    if (!text) return null;
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** A development convenience only: a browser has no Keychain. */
const webSecrets: SecretStore = {
  async get(name) {
    try {
      return localStorage.getItem(SECRET_PREFIX + name);
    } catch {
      return null;
    }
  },
  async set(name, value) {
    localStorage.setItem(SECRET_PREFIX + name, value);
  },
  async delete(name) {
    localStorage.removeItem(SECRET_PREFIX + name);
  },
};

const webFiles: FileAccess = {
  pickFiles({ accept, multiple }) {
    return pickWithInput(accept.join(","), multiple);
  },
  pickPhotos(options) {
    return pickWithInput("image/*", options?.multiple);
  },
  async share(file) {
    const blob = new Blob([file.data as BlobPart], { type: file.mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  },
};

const timers = new Map<number, ReturnType<typeof setTimeout>>();

const webNotifier: Notifier = {
  async requestPermission() {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    return (await Notification.requestPermission()) === "granted";
  },
  async schedule(reminders) {
    for (const reminder of reminders) {
      const delay = reminder.at.getTime() - Date.now();
      if (delay < 0 || delay > 2 ** 31 - 1) continue;
      clearTimeout(timers.get(reminder.id));
      timers.set(
        reminder.id,
        setTimeout(() => new Notification(reminder.title, { body: reminder.body }), delay),
      );
    }
  },
  async cancel(ids) {
    for (const id of ids) {
      clearTimeout(timers.get(id));
      timers.delete(id);
    }
  },
};

const webSpeech: Speech = {
  get available() {
    return typeof speechSynthesis !== "undefined";
  },
  speak(text, options) {
    return new Promise((resolve) => {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = options?.rate ?? 1;
      utterance.lang = options?.lang ?? "en-US";
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      speechSynthesis.speak(utterance);
    });
  },
  async stop() {
    speechSynthesis.cancel();
  },
};

const webHaptics: Haptics = {
  async impact(kind) {
    navigator.vibrate?.(kind === "tap" ? 8 : 20);
  },
};

export async function createWebPlatform(): Promise<Platform> {
  return {
    name: "ios",
    storage: await openWebDatabase(),
    secrets: webSecrets,
    files: webFiles,
    notifications: webNotifier,
    speech: webSpeech,
    haptics: webHaptics,
    license: developmentLicense,
  };
}
