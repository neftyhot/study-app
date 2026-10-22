/**
 * The iOS answers to `@megan/core/platform/types`, through Capacitor plugins.
 *
 * Nothing here knows about cards or decks; it only gives the shared code a
 * database, a Keychain, the Files app, the share sheet, notifications, speech
 * and the tap engine.
 */
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from "@capacitor-community/sqlite";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { Camera } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Haptics as NativeHaptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Share } from "@capacitor/share";

import type {
  FileAccess,
  Haptics,
  Notifier,
  PickedFile,
  Platform,
  SecretStore,
  Speech,
  SqlDriver,
  SqlValue,
} from "@megan/core/platform/types";

import { developmentLicense } from "./license";
import { pickWithInput, toBase64 } from "./shared";

export const DATABASE_NAME = "study-app";

/* ------------------------------------------------------------------ Storage */

/**
 * The same SQLite schema as the desktop, in the app's Library folder (which
 * iCloud device backups include). One connection for the app's life; a web
 * view reload finds the one it already opened rather than opening twice.
 */
export async function openIosDatabase(): Promise<SqlDriver> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  await sqlite.checkConnectionsConsistency().catch(() => undefined);
  const existing = (await sqlite.isConnection(DATABASE_NAME, false)).result;
  const connection = existing
    ? await sqlite.retrieveConnection(DATABASE_NAME, false)
    : await sqlite.createConnection(DATABASE_NAME, false, "no-encryption", 1, false);
  if (!(await connection.isDBOpen()).result) await connection.open();
  return sqliteDriver(connection);
}

function sqliteDriver(connection: SQLiteDBConnection): SqlDriver {
  // The plugin wraps each call in its own transaction unless told not to;
  // inside ours that would nest, so every call says `false` and we own it.
  let depth = 0;
  return {
    async exec(sql) {
      await connection.execute(sql, false);
    },
    async run(sql, params = []) {
      const result = await connection.run(sql, params.map(toPlugin), false);
      return { changes: result.changes?.changes ?? 0 };
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      const result = await connection.query(sql, params.map(toPlugin));
      return (result.values ?? []) as T[];
    },
    async transaction<T>(work: () => Promise<T>) {
      // A nested call joins the outer transaction rather than opening another.
      if (depth > 0) return work();
      depth += 1;
      await connection.beginTransaction();
      try {
        const value = await work();
        await connection.commitTransaction();
        return value;
      } catch (error) {
        await connection.rollbackTransaction().catch(() => undefined);
        throw error;
      } finally {
        depth -= 1;
      }
    },
  };
}

/** The plugin crosses a JSON bridge: bytes go over as a plain array. */
function toPlugin(value: SqlValue): unknown {
  return value instanceof Uint8Array ? Array.from(value) : value;
}

/* ------------------------------------------------------------------ Secrets */

/**
 * The Keychain, readable only while the phone is unlocked and never synced
 * to iCloud Keychain: a student's API key stays on the device that owns it.
 */
export const iosSecrets: SecretStore = {
  async get(name) {
    const value = await SecureStorage.get(name, false, false);
    return typeof value === "string" ? value : null;
  },
  async set(name, value) {
    await SecureStorage.set(name, value, false, false);
  },
  async delete(name) {
    await SecureStorage.remove(name, false);
  },
};

/* -------------------------------------------------------------------- Files */

export const iosFiles: FileAccess = {
  // A file input opens the Files app picker on iOS, with iCloud Drive,
  // AirDrop'd downloads and every file provider the student has.
  pickFiles({ accept, multiple }) {
    return pickWithInput(accept.join(","), multiple);
  },

  async pickPhotos(options) {
    try {
      if (options?.camera) {
        const photo = await Camera.takePhoto({ quality: 85, targetWidth: 2400, correctOrientation: true });
        const file = await readMedia(photo.uri ?? photo.webPath, "photo-1.jpg");
        return file ? [file] : [];
      }
      const { results } = await Camera.chooseFromGallery({
        allowMultipleSelection: options?.multiple ?? false,
        limit: options?.multiple ? 10 : 1,
      });
      const files = await Promise.all(
        results.map((result, index) => readMedia(result.uri ?? result.webPath, `photo-${index + 1}.jpg`)),
      );
      return files.filter((file): file is PickedFile => file !== null);
    } catch (error) {
      // Cancelling the picker rejects; that is not an error to the student.
      if (/cancel/i.test(String((error as Error)?.message ?? error))) return [];
      throw error;
    }
  },

  async share(file) {
    // The share sheet takes a file URL, so the export is written to the cache
    // first. iOS clears that folder itself when it needs the space.
    const text = typeof file.data === "string";
    const written = await Filesystem.writeFile({
      path: file.name,
      directory: Directory.Cache,
      data: text ? (file.data as string) : toBase64(file.data as Uint8Array),
      ...(text ? { encoding: Encoding.UTF8 } : {}),
    });
    try {
      await Share.share({ title: file.name, files: [written.uri] });
      return true;
    } catch (error) {
      if (/cancel/i.test(String((error as Error)?.message ?? error))) return false;
      throw error;
    }
  },
};

async function readMedia(uri: string | undefined, name: string): Promise<PickedFile | null> {
  if (!uri) return null;
  const response = await fetch(uri.startsWith("http") ? uri : Capacitor.convertFileSrc(uri));
  const blob = await response.blob();
  return {
    name: uri.split("/").pop() || name,
    type: blob.type || "image/jpeg",
    bytes: new Uint8Array(await blob.arrayBuffer()),
  };
}

/* ------------------------------------------------------------ Notifications */

/**
 * Local notifications, scheduled ahead: unlike the desktop, a reminder on
 * iOS arrives even when the app is closed.
 */
export const iosNotifier: Notifier = {
  async requestPermission() {
    const current = await LocalNotifications.checkPermissions();
    if (current.display === "granted") return true;
    if (current.display === "denied") return false;
    return (await LocalNotifications.requestPermissions()).display === "granted";
  },
  async schedule(reminders) {
    if (reminders.length === 0) return;
    await LocalNotifications.schedule({
      notifications: reminders.map((reminder) => ({
        id: reminder.id,
        title: reminder.title,
        body: reminder.body,
        schedule: { at: reminder.at, allowWhileIdle: true },
      })),
    });
  },
  async cancel(ids) {
    if (ids.length === 0) return;
    await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
  },
};

/* ------------------------------------------------------------------- Speech */

export const iosSpeech: Speech = {
  available: true,
  async speak(text, options) {
    await TextToSpeech.speak({
      text,
      lang: options?.lang ?? "en-US",
      rate: options?.rate ?? 1,
      category: "playback",
    });
  },
  async stop() {
    await TextToSpeech.stop();
  },
};

/* ------------------------------------------------------------------ Haptics */

export const iosHaptics: Haptics = {
  async impact(kind) {
    if (kind === "tap") await NativeHaptics.impact({ style: ImpactStyle.Light });
    else
      await NativeHaptics.notification({
        type: kind === "success" ? NotificationType.Success : NotificationType.Warning,
      });
  },
};

export async function createIosPlatform(): Promise<Platform> {
  return {
    name: "ios",
    storage: await openIosDatabase(),
    secrets: iosSecrets,
    files: iosFiles,
    notifications: iosNotifier,
    speech: iosSpeech,
    haptics: iosHaptics,
    license: developmentLicense,
  };
}
