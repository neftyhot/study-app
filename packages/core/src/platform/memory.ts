/**
 * In-memory stand-ins for the device adapters: what tests and a browser
 * preview of the iOS app use where there is no device to ask.
 */
import type { FileAccess, Haptics, HapticKind, LicenseProvider, Notifier, Reminder, SecretStore, Speech } from "./types";

export class MemorySecretStore implements SecretStore {
  private values = new Map<string, string>();
  async get(name: string) {
    return this.values.get(name) ?? null;
  }
  async set(name: string, value: string) {
    this.values.set(name, value);
  }
  async delete(name: string) {
    this.values.delete(name);
  }
}

export class MemoryNotifier implements Notifier {
  scheduled = new Map<number, Reminder>();
  constructor(private allowed = true) {}
  async requestPermission() {
    return this.allowed;
  }
  async schedule(reminders: Reminder[]) {
    for (const reminder of reminders) this.scheduled.set(reminder.id, reminder);
  }
  async cancel(ids: number[]) {
    for (const id of ids) this.scheduled.delete(id);
  }
}

export class SilentSpeech implements Speech {
  readonly available = false;
  async speak() {}
  async stop() {}
}

export class RecordingHaptics implements Haptics {
  taps: HapticKind[] = [];
  async impact(kind: HapticKind) {
    this.taps.push(kind);
  }
}

export const noFiles: FileAccess = {
  async pickFiles() {
    return [];
  },
  async pickPhotos() {
    return [];
  },
  async share() {
    return false;
  },
};

/** Full access, for development builds before any purchasing exists. */
export const developmentLicense: LicenseProvider = {
  async access() {
    return { full: true, source: "development" };
  },
};
