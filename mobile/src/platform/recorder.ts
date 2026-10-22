/**
 * The lecture recorder, a plugin built into the iPhone app
 * (ios/App/App/LectureRecorderPlugin.swift). It keeps recording with the
 * screen locked and transcribes on the phone. In the browser preview every
 * call explains that recording needs the iPhone app.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

import type { TranscriptSegment } from "@megan/core/lectures/format";

export type RecorderStatus = { recording: boolean; paused: boolean; seconds: number; level: number; file?: string };

type LectureRecorderPlugin = {
  start(): Promise<{ file: string }>;
  pause(): Promise<RecorderStatus>;
  resume(): Promise<RecorderStatus>;
  stop(): Promise<{ file: string; seconds: number }>;
  status(): Promise<RecorderStatus>;
  transcribe(options: { file: string; locale?: string }): Promise<{ segments: TranscriptSegment[]; onDevice: boolean }>;
  remove(options: { file: string }): Promise<void>;
  setKeepAwake(options: { on: boolean }): Promise<void>;
  addListener(
    event: "transcribeProgress",
    listener: (progress: { done: number; total: number }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(event: "interruption", listener: (info: { resumed: boolean }) => void): Promise<PluginListenerHandle>;
};

export const NEEDS_IPHONE = "Recording lectures works in the iPhone app.";

const unavailable = () => Promise.reject(new Error(NEEDS_IPHONE));

export const recorder = registerPlugin<LectureRecorderPlugin>("LectureRecorder", {
  web: {
    start: unavailable,
    pause: unavailable,
    resume: unavailable,
    stop: unavailable,
    status: () => Promise.resolve({ recording: false, paused: false, seconds: 0, level: 0 }),
    transcribe: unavailable,
    remove: () => Promise.resolve(),
    setKeepAwake: () => Promise.resolve(),
    addListener: () => Promise.resolve({ remove: () => Promise.resolve() }),
  },
});

export const canRecord = () => Capacitor.isNativePlatform();

/** The phone's language for the speech recognizer, e.g. `en-US`. */
export const speechLocale = () => (typeof navigator !== "undefined" && navigator.language) || "en-US";
