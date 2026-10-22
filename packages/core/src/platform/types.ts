/**
 * What the study logic needs from the device it runs on.
 *
 * The desktop app answers these with Node and Electron (`src/lib/platform`);
 * the iOS app answers them with Capacitor plugins (`mobile/src/platform`).
 * Everything above this line — scheduling, Learn, grading, sharing — is the
 * same code on both.
 */

/* ------------------------------------------------------------------ Storage */

export type SqlValue = string | number | null | Uint8Array;

/**
 * A SQLite database. Async because the iOS plugin talks to native code;
 * the desktop wraps better-sqlite3, which is synchronous underneath.
 */
export interface SqlDriver {
  /** Runs one or more statements that return nothing. */
  exec(sql: string): Promise<void>;
  /** Runs one statement with parameters. */
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  /** Runs one query and returns its rows as objects. */
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** Runs `work` inside BEGIN/COMMIT, rolling back if it throws. */
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

/* ------------------------------------------------------------------ Secrets */

/** API keys: the macOS/Windows safeStorage file on desktop, the Keychain on iOS. */
export interface SecretStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

/* -------------------------------------------------------------------- Files */

export type PickedFile = {
  name: string;
  /** MIME type when the system knows it. */
  type: string | null;
  bytes: Uint8Array;
};

export type OutgoingFile = {
  name: string;
  mime: string;
  /** Text files are passed as a string; anything else as bytes. */
  data: string | Uint8Array;
};

export interface FileAccess {
  /** The Files app / Finder picker. `accept` lists extensions like ".meganstudy". */
  pickFiles(options: { accept: string[]; multiple?: boolean }): Promise<PickedFile[]>;
  /** The photo library (and camera on iOS), for "Snap your notes". */
  pickPhotos(options?: { multiple?: boolean; camera?: boolean }): Promise<PickedFile[]>;
  /** The share sheet: AirDrop, Messages, Save to Files. Resolves false if the student cancels. */
  share(file: OutgoingFile): Promise<boolean>;
}

/* ------------------------------------------------------------ Notifications */

export type Reminder = {
  /** Stable id, so rescheduling replaces rather than duplicates. */
  id: number;
  title: string;
  body: string;
  at: Date;
};

export interface Notifier {
  /** Asks once; returns whether reminders may be shown. */
  requestPermission(): Promise<boolean>;
  schedule(reminders: Reminder[]): Promise<void>;
  cancel(ids: number[]): Promise<void>;
}

/* ------------------------------------------------------------------- Speech */

export interface Speech {
  readonly available: boolean;
  speak(text: string, options?: { rate?: number; lang?: string }): Promise<void>;
  stop(): Promise<void>;
}

/* ------------------------------------------------------------------ Haptics */

/** "tap" on a grade button or swipe; "success"/"warning" for a right or missed answer. */
export type HapticKind = "tap" | "success" | "warning";

export interface Haptics {
  impact(kind: HapticKind): Promise<void>;
}

/* ----------------------------------------------------------------- Licensing */

export type LicenseAccess = {
  /** Whether studying, generating and every paid feature is open. */
  full: boolean;
  /** Where the answer came from, for the Settings screen. */
  source: "license" | "trial" | "development" | "desktop-link" | "none";
  /** Days left in a trial, when there is one. */
  trialDaysLeft?: number;
};

/**
 * Who may use the app. The desktop answers from its existing license and
 * trial code, unchanged; iOS has no purchasing yet and answers "full" in
 * development (see docs/MOBILE_ARCHITECTURE.md for the options).
 */
export interface LicenseProvider {
  access(): Promise<LicenseAccess>;
}

/* ------------------------------------------------------------------- Bundle */

export interface Platform {
  name: "desktop" | "ios";
  storage: SqlDriver;
  secrets: SecretStore;
  files: FileAccess;
  notifications: Notifier;
  speech: Speech;
  haptics: Haptics;
  license: LicenseProvider;
}

/** What iOS shows in place of a feature it does not have yet. */
export const DESKTOP_ONLY_FEATURES = [
  { id: "lectures", label: "Lecture recording and transcription" },
  { id: "local-ai", label: "Local AI models" },
  { id: "libreoffice", label: "Old .doc and .ppt files (LibreOffice)" },
  { id: "occlusion", label: "Image occlusion editor" },
  { id: "bulk-edit", label: "Bulk editing" },
  { id: "catalog-publish", label: "Publishing to the catalog" },
] as const;

export type DesktopOnlyFeature = (typeof DESKTOP_ONLY_FEATURES)[number]["id"];

export const AVAILABLE_ON_DESKTOP = "Available on desktop";
