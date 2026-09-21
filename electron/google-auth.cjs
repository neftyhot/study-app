/**
 * "Sign in with Google", wired into the main process.
 *
 * The flow and the storage live in `src/main/auth/` as TypeScript, loaded
 * directly in development (Electron's Node strips the types) and bundled into
 * the bytecode for a packaged build. This file connects them to the things
 * only the main process has: `shell`, `safeStorage`, `ipcMain`, and the
 * database path.
 *
 * Nothing here touches the network until the student presses the button, or
 * until a Gemini call needs a token refreshed.
 */
const { ipcMain, safeStorage, shell } = require("electron");
const path = require("node:path");

const {
  cleanCredential,
  refreshAccessToken,
  revokeToken,
  signInWithGoogle,
} = require("../src/main/auth/googleOAuth.ts");
const {
  clearSession,
  createTokenRefresher,
  readRefreshToken,
  saveSession,
  sessionStatus,
} = require("../src/main/auth/tokenStore.ts");
const {
  GOOGLE_AUTH_BRIDGE_KEY,
  GOOGLE_AUTH_CHANNELS,
} = require("../src/main/auth/ipc.ts");

/**
 * The OAuth client. Read from `.env.local` in development; a packaged build
 * has these replaced with literals at compile time (scripts/compile-main.mjs),
 * because there is no environment to read them from on a student's machine.
 */
function oauthConfig() {
  const clientId = cleanCredential(process.env.GOOGLE_OAUTH_CLIENT_ID);
  const clientSecret = cleanCredential(process.env.GOOGLE_OAUTH_CLIENT_SECRET);
  // The secret may be empty: postToken then leaves it out of the request.
  if (!clientId) return null;
  return { clientId, clientSecret };
}

let database = null;

/** The app's own database, opened on first use. */
function db() {
  if (!database) {
    const Database = require("better-sqlite3");
    const file = path.resolve(
      process.env.DATABASE_URL.replace(/^file:/, ""),
    );
    database = new Database(file);
    database.pragma("journal_mode = WAL");
  }
  return database;
}

let refresherInstance = null;

/** Created on first use, so nothing opens the database before migrations run. */
function refresher() {
  refresherInstance ??= createTokenRefresher({
    db: db(),
    cipher: safeStorage,
    refresh: (refreshToken) => {
      const config = oauthConfig();
      if (!config) throw new Error("Google sign-in is not configured.");
      return refreshAccessToken({ config, refreshToken });
    },
  });
  return refresherInstance;
}

/**
 * @param {{ isDev: boolean, appOrigin: () => string | null }} options
 *   `appOrigin` is where the app window is loaded from; IPC from any other
 *   frame (the activation screen, a page that somehow navigated elsewhere)
 *   is refused.
 */
function registerGoogleAuth({ isDev, appOrigin }) {
  // The packaged Next server runs in this process and finds this by key.
  globalThis[Symbol.for(GOOGLE_AUTH_BRIDGE_KEY)] = {
    getAccessToken: () => refresher().getAccessToken(),
  };

  if (isDev) {
    // `next dev` is a separate process with no bridge; it reads the stored
    // access token directly. Keep that token at least ten minutes from
    // expiry so a request never picks up one that lapses in flight.
    const keepFresh = async () => {
      try {
        await refresher().getAccessToken({ skewMs: 10 * 60_000 });
      } catch (error) {
        console.warn(`[google-auth] refresh failed: ${error.message}`);
      }
    };
    void keepFresh();
    setInterval(keepFresh, 5 * 60_000).unref();
  }

  function fromApp(event) {
    const origin = appOrigin();
    const url = event.senderFrame?.url;
    return Boolean(origin && url && new URL(url).origin === origin);
  }

  function status() {
    try {
      return sessionStatus(db());
    } catch {
      // Database not migrated yet (a fresh dev checkout): nobody is signed in.
      return { connected: false };
    }
  }

  ipcMain.handle(GOOGLE_AUTH_CHANNELS.status, (event) => {
    if (!fromApp(event)) return { connected: false };
    return status();
  });

  let pending = null;

  ipcMain.handle(GOOGLE_AUTH_CHANNELS.signIn, async (event) => {
    if (!fromApp(event)) return { ok: false, error: "Not allowed." };

    const config = oauthConfig();
    if (!config) {
      return {
        ok: false,
        error:
          "Google sign-in is not configured in this build (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET).",
      };
    }

    // A second click abandons the first attempt rather than stacking two
    // listeners and two browser tabs.
    pending?.abort();
    const controller = new AbortController();
    pending = controller;

    try {
      const { tokens, email } = await signInWithGoogle({
        config,
        openExternal: (url) => shell.openExternal(url),
        signal: controller.signal,
      });

      saveSession(db(), safeStorage, {
        email,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        scope: tokens.scope,
      });

      return { ok: true, status: status() };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (pending === controller) pending = null;
    }
  });

  ipcMain.handle(GOOGLE_AUTH_CHANNELS.signOut, async (event) => {
    if (!fromApp(event)) return status();

    pending?.abort();

    let refreshToken = null;
    try {
      refreshToken = readRefreshToken(db(), safeStorage);
    } catch {
      // Undecryptable (keychain reset): nothing to revoke, still clear it.
    }

    try {
      clearSession(db());
    } catch {
      // No table, so no session.
    }

    // Revoking the refresh token ends the grant on Google's side too, so the
    // app disappears from the student's third-party access list.
    if (refreshToken) await revokeToken(refreshToken);

    return status();
  });
}

module.exports = { registerGoogleAuth };
