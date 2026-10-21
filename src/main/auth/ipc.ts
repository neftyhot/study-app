/**
 * The contract between the app window, the Electron main process, and the
 * Next server for "Sign in with Google".
 *
 * Two boundaries, both typed here:
 *
 *  - **Renderer ↔ main**, over IPC. The window can start a sign-in, sign out,
 *    and ask who is signed in. It is never handed a token.
 *  - **Next server → main**, in-process. The packaged app runs the Next
 *    server inside the main process, so the main process leaves a
 *    `GoogleAuthBridge` on `globalThis` under `GOOGLE_AUTH_BRIDGE_KEY`, and
 *    Gemini calls ask it for a token — refreshing through the keychain if the
 *    stored one is about to lapse. In development the server is a separate
 *    `next dev` process with no bridge, and reads the stored access token
 *    from the shared database instead, which the main process keeps fresh.
 *
 * `electron/app-preload.cjs` repeats the channel names, because a sandboxed
 * preload cannot load this file.
 */

export const GOOGLE_AUTH_CHANNELS = {
  status: "google-auth:status",
  signIn: "google-auth:sign-in",
  signOut: "google-auth:sign-out",
} as const;

export type GoogleAuthStatus =
  | { connected: true; email: string | null }
  | { connected: false };

export type GoogleSignInResult =
  | { ok: true; status: GoogleAuthStatus }
  | { ok: false; error: string };

/** What the preload puts on `window.studyApp.googleAuth`. */
export type GoogleAuthApi = {
  status(): Promise<GoogleAuthStatus>;
  /**
   * Opens Google's consent page in the default browser and resolves once the
   * student has finished there (or given up).
   */
  signIn(): Promise<GoogleSignInResult>;
  signOut(): Promise<GoogleAuthStatus>;
};

/** Registry key for the in-process bridge; `Symbol.for` so both bundles agree. */
export const GOOGLE_AUTH_BRIDGE_KEY = "study-app.google-auth-bridge";

export type GoogleAuthBridge = {
  /** A token with at least a minute left, or null when nobody is signed in. */
  getAccessToken(): Promise<string | null>;
};

/** What `license:check-purchase` answers. */
export type PurchaseCheck =
  | { configured: boolean; found: false }
  | {
      configured: boolean;
      found: true;
      valid: boolean;
      message: string | null;
    };

/** What the preload puts on `window.studyApp.license`. */
export type LicenseApi = {
  /** Opens the Stripe checkout for this machine in the default browser. */
  purchase(): Promise<void>;
  /** Asks the licensing server for a key bought for this machine. */
  checkPurchase(): Promise<PurchaseCheck>;
};

/** What the preload puts on `window.studyApp.update` (electron/updater.cjs). */
export type UpdateApi = {
  /** Installs GitHub's latest release in place; the app restarts on success. */
  install(): Promise<{ ok: true; version: string } | { ok: false; error: string }>;
};

/** What the preload puts on `window.studyApp.tutor`: a picture of the app window. */
export type TutorApi = {
  /** A JPEG data URL of the window as it is now, or null if it could not be taken. */
  captureScreen(): Promise<string | null>;
};

/** A Whisper model the Lectures tab can download; see electron/lectures.cjs. */
export type WhisperModelState = {
  id: string;
  name: string;
  file: string;
  /** Size of the whole download. */
  bytes: number;
  description: string;
  recommended: boolean;
  status: "missing" | "downloading" | "verifying" | "ready" | "error";
  receivedBytes: number;
  error: string | null;
};

/** One recording on its way to being a transcript. */
export type LectureJob = {
  id: string;
  /** The saved transcript's id, once `status` is "done". */
  lectureId: string | null;
  title: string;
  fileName: string;
  modelId: string;
  status: "queued" | "converting" | "transcribing" | "saving" | "done" | "error" | "cancelled";
  /** 0 to 100, of the current step. */
  progress: number;
  /** The sentence Whisper heard most recently. */
  preview: string;
  error: string | null;
};

export type LecturesSnapshot = {
  /** False when this copy of the app has no transcription tools. */
  available: boolean;
  unavailableReason: string | null;
  /** File extensions accepted, without the dot. */
  extensions: string[];
  models: WhisperModelState[];
  jobs: LectureJob[];
  recording: LectureRecording | null;
  /** About a recording that ended without being asked to, until dismissed. */
  notice: { id: string; text: string; lectureId: string | null } | null;
};

/** The lecture being recorded in the app right now. */
export type LectureRecording = {
  id: string;
  title: string;
  /** Milliseconds since the epoch. */
  startedAt: number;
  paused: boolean;
  /** The microphone is off; what to do with the recording is not yet chosen. */
  stopped: boolean;
  /** Being written out as a lecture. */
  saving: boolean;
  /** Set when the computer is going to sleep: hand over the audio and end. */
  interrupted: string | null;
  live: {
    /** False when it was not asked for, or no model is downloaded. */
    enabled: boolean;
    /** What has been heard so far; `at` is seconds into the recording. */
    lines: { at: number; text: string }[];
  };
};

/** How a recording ended early; decides what the student is told. */
export type RecordingEndReason = "sleep" | "closed" | "mic";

type LecturesResult = { ok: true } | { ok: false; error: string };

/** What the preload puts on `window.studyApp.lectures`. */
export type LecturesApi = {
  state(): Promise<LecturesSnapshot>;
  downloadModel(modelId: string): Promise<LecturesResult>;
  cancelDownload(modelId: string): Promise<LecturesResult>;
  deleteModel(modelId: string): Promise<LecturesResult>;
  /** Opens the system file picker; the chosen paths, or none. */
  pickFiles(): Promise<string[]>;
  /** The path of a file dropped on the window, or "" if it has none. */
  pathForFile(file: File): string;
  transcribe(request: {
    paths: string[];
    modelId: string;
  }): Promise<{ ok: boolean; error?: string; queued?: number; rejected?: string[] }>;
  /** Transcribes a lecture that was recorded and saved for later. */
  transcribeLecture(request: { lectureId: string; modelId: string }): Promise<LecturesResult>;
  cancelJob(jobId: string): Promise<LecturesResult>;
  dismissJob(jobId: string): Promise<LecturesResult>;
  startRecording(request: {
    title: string;
    live: boolean;
    modelId: string;
  }): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  /** The next few seconds of sound, in the order they were recorded. */
  appendRecording(request: { id: string; chunk: ArrayBuffer }): Promise<LecturesResult>;
  updateRecording(request: {
    id: string;
    title?: string;
    paused?: boolean;
    live?: boolean;
    stopped?: boolean;
  }): Promise<LecturesResult>;
  /** Saves the recording as a lecture (or throws it away) and ends it. */
  finishRecording(request: {
    id: string;
    action: "transcribe" | "later" | "discard";
    title?: string;
    modelId?: string;
    reason?: RecordingEndReason;
  }): Promise<
    { ok: true; lectureId: string | null; transcribing: boolean } | { ok: false; error: string }
  >;
  dismissNotice(): Promise<LecturesResult>;
  micAccess(): Promise<"granted" | "denied" | "restricted" | "not-determined" | "unknown">;
  openMicSettings(): Promise<LecturesResult>;
  /** Calls `listener` whenever a download or a job moves; returns how to stop. */
  onChange(listener: (snapshot: LecturesSnapshot) => void): () => void;
};

declare global {
  interface Window {
    /** Present only inside the desktop app. */
    studyApp?: {
      googleAuth: GoogleAuthApi;
      license: LicenseApi;
      update?: UpdateApi;
      tutor?: TutorApi;
      lectures?: LecturesApi;
    };
  }
}
