/**
 * Retires "Sign in with Google" for Gemini.
 *
 * Calls signed with a sign-in token were billed to the developer's Google
 * Cloud project, not the student's. Every student now brings their own
 * Google AI Studio key, so on startup any stored session is deleted and its
 * refresh token revoked, and the old IPC channels answer "not signed in".
 *
 * The flow in `src/main/auth/` stays, unused, so this can be undone later.
 */
const { ipcMain, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const { revokeToken } = require("../src/main/auth/googleOAuth.ts");
const { clearSession, readRefreshToken } = require("../src/main/auth/tokenStore.ts");
const { GOOGLE_AUTH_CHANNELS } = require("../src/main/auth/ipc.ts");

/**
 * Deletes a stored Google session and revokes it on Google's side.
 *
 * Never throws: a database that does not exist yet, has no sessions table,
 * or holds a token the keychain can no longer open all mean the same thing
 * — there is nothing left to use.
 */
async function retireGoogleSession() {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const file = path.resolve(url.replace(/^file:/, ""));
  // A fresh install: opening would create the file before migrations run.
  if (!fs.existsSync(file)) return;

  let refreshToken = null;
  let database = null;
  try {
    const Database = require("better-sqlite3");
    database = new Database(file);
    try {
      refreshToken = readRefreshToken(database, safeStorage);
    } catch {
      // Undecryptable or no table: nothing to revoke, still clear it.
    }
    try {
      clearSession(database);
    } catch {
      // No table, so no session.
    }
  } catch (error) {
    console.warn(`[google-auth] could not retire the Google session: ${error.message}`);
  } finally {
    database?.close();
  }

  // Ends the grant on Google's side too, so the app leaves the student's
  // third-party access list and the token can never be used again.
  if (refreshToken) await revokeToken(refreshToken);
}

/** @param {{ isDev: boolean, appOrigin: () => string | null }} _options */
function registerGoogleAuth(_options) {
  void retireGoogleSession();

  const signedOut = { connected: false };
  ipcMain.handle(GOOGLE_AUTH_CHANNELS.status, () => signedOut);
  ipcMain.handle(GOOGLE_AUTH_CHANNELS.signIn, () => ({
    ok: false,
    error: "Google sign-in has been replaced. Paste your Google AI Studio key in Settings.",
  }));
  ipcMain.handle(GOOGLE_AUTH_CHANNELS.signOut, async () => {
    await retireGoogleSession();
    return signedOut;
  });
}

module.exports = { registerGoogleAuth, retireGoogleSession };
