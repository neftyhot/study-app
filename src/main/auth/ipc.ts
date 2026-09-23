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

declare global {
  interface Window {
    /** Present only inside the desktop app. */
    studyApp?: { googleAuth: GoogleAuthApi; license: LicenseApi; update?: UpdateApi };
  }
}
