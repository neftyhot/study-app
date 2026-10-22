"use client";

import type {
  FileAccess,
  Haptics,
  Notifier,
  PickedFile,
  Speech,
} from "@megan/core/platform/types";
import { canReadAloud, readAloud, stopReading } from "@/lib/speech/read-aloud";

/**
 * The desktop's browser-side adapters. The study screens already call
 * read-aloud and the share bridge directly; these wrap the same calls behind
 * the shared interfaces so code written against them runs on iOS too.
 */

export const desktopSpeech: Speech = {
  get available() {
    return canReadAloud();
  },
  speak(text) {
    return new Promise((resolve) => readAloud(text, resolve));
  },
  async stop() {
    stopReading();
  },
};

/** Macs have no tap engine a web page can reach; trackpad force touch is not exposed. */
export const desktopHaptics: Haptics = {
  async impact() {},
};

/** System notifications while the app is open, the same way study reminders already work. */
export const desktopNotifier: Notifier = {
  async requestPermission() {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    return (await Notification.requestPermission()) === "granted";
  },
  async schedule(reminders) {
    for (const reminder of reminders) {
      const delay = reminder.at.getTime() - Date.now();
      // Timers only live as long as the window; reminders need the app open.
      if (delay < 0 || delay > 2 ** 31 - 1) continue;
      cancelTimer(reminder.id);
      timers.set(
        reminder.id,
        setTimeout(() => {
          timers.delete(reminder.id);
          new Notification(reminder.title, { body: reminder.body });
        }, delay),
      );
    }
  },
  async cancel(ids) {
    ids.forEach(cancelTimer);
  },
};

const timers = new Map<number, ReturnType<typeof setTimeout>>();

function cancelTimer(id: number) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
}

export const desktopFiles: FileAccess = {
  pickFiles({ accept, multiple }) {
    return pick(accept.join(","), multiple);
  },
  pickPhotos(options) {
    return pick("image/*", options?.multiple);
  },
  async share(file) {
    const send = window.studyApp?.shareFiles?.send;
    if (!send || typeof file.data !== "string") return false;
    const { result } = await send({ name: file.name, text: file.data });
    return result === "shared" || result === "saved";
  },
};

function pick(accept: string, multiple = false): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener("change", async () => {
      const files = Array.from(input.files ?? []);
      resolve(
        await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            type: file.type || null,
            bytes: new Uint8Array(await file.arrayBuffer()),
          })),
        ),
      );
    });
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}
