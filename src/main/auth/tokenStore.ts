/**
 * Where a Google sign-in lives between launches, and how it stays usable.
 *
 * One row in `google_oauth_sessions`, in the same SQLite database as
 * everything else. The refresh token is the long-lived credential — it can
 * mint access tokens for as long as the student leaves the grant in place —
 * so it is encrypted with Electron's `safeStorage` (the macOS Keychain,
 * Windows DPAPI, libsecret on Linux) before it is written. A copied database
 * file is useless without the login keychain it was made under.
 *
 * The access token is stored in the clear: it expires within the hour, and
 * the web server, which cannot reach the keychain, has to read it to call
 * Gemini.
 *
 * Electron is handed in as a `Cipher`, and the database as anything with
 * better-sqlite3's `prepare`, so this is tested against an in-memory database
 * with no Electron in sight. Like `googleOAuth.ts`, it has no relative
 * runtime imports, because Electron loads it directly in development.
 */
import type { TokenSet } from "./googleOAuth";

/** Refresh when the token has less than this long left, not after it has gone. */
export const EXPIRY_SKEW_MS = 60_000;

const SESSION_ID = "default";

/** The slice of `safeStorage` this needs. */
export type Cipher = {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
};

/** The slice of a better-sqlite3 `Database` this needs. */
export type SqlDatabase = {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
  };
};

export type StoredSession = {
  email: string | null;
  accessToken: string;
  /** Epoch milliseconds. */
  accessTokenExpiresAt: number;
  scope: string | null;
};

/** What the renderer is told. Never a token. */
export type SessionStatus =
  | { connected: true; email: string | null }
  | { connected: false };

type Row = {
  email: string | null;
  access_token: string;
  access_token_expires_at: number;
  refresh_token_encrypted: string;
  scope: string | null;
};

/* ------------------------------------------------------------- Read/write */

/**
 * Saves a fresh sign-in, replacing any earlier one.
 *
 * Refuses outright when the OS offers no encryption (a Linux desktop with no
 * keyring): writing the refresh token in the clear and calling it stored
 * securely would be worse than not signing in.
 */
export function saveSession(
  db: SqlDatabase,
  cipher: Cipher,
  session: {
    email: string | null;
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    scope?: string | null;
  },
  now: number = Date.now(),
) {
  if (!cipher.isEncryptionAvailable()) {
    throw new Error(
      "This system has no secure storage available (on Linux, install and unlock a keyring such as GNOME Keyring), so the Google sign-in cannot be saved.",
    );
  }

  const encrypted = cipher.encryptString(session.refreshToken).toString("base64");

  db.prepare(
    `INSERT INTO google_oauth_sessions
       (id, email, access_token, access_token_expires_at, refresh_token_encrypted, scope, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, current_timestamp)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       access_token = excluded.access_token,
       access_token_expires_at = excluded.access_token_expires_at,
       refresh_token_encrypted = excluded.refresh_token_encrypted,
       scope = excluded.scope,
       updated_at = current_timestamp`,
  ).run(
    SESSION_ID,
    session.email,
    session.accessToken,
    now + session.expiresIn * 1000,
    encrypted,
    session.scope ?? null,
  );
}

export function readSession(db: SqlDatabase): StoredSession | null {
  const row = readRow(db);
  if (!row) return null;

  return {
    email: row.email,
    accessToken: row.access_token,
    accessTokenExpiresAt: row.access_token_expires_at,
    scope: row.scope,
  };
}

export function sessionStatus(db: SqlDatabase): SessionStatus {
  const session = readSession(db);
  return session ? { connected: true, email: session.email } : { connected: false };
}

/** Decrypts the refresh token, or null when there is no session. */
export function readRefreshToken(db: SqlDatabase, cipher: Cipher): string | null {
  const row = readRow(db);
  if (!row) return null;
  return cipher.decryptString(Buffer.from(row.refresh_token_encrypted, "base64"));
}

export function clearSession(db: SqlDatabase) {
  db.prepare("DELETE FROM google_oauth_sessions WHERE id = ?").run(SESSION_ID);
}

function readRow(db: SqlDatabase): Row | null {
  return (
    (db
      .prepare(
        `SELECT email, access_token, access_token_expires_at, refresh_token_encrypted, scope
           FROM google_oauth_sessions WHERE id = ?`,
      )
      .get(SESSION_ID) as Row | undefined) ?? null
  );
}

/* ---------------------------------------------------------------- Refresh */

/** Whether a token expiring at `expiresAt` needs replacing before use. */
export function isExpiring(
  expiresAt: number,
  now: number = Date.now(),
  skewMs: number = EXPIRY_SKEW_MS,
): boolean {
  return expiresAt - now <= skewMs;
}

export type TokenRefresher = {
  /**
   * A usable access token, refreshing first if it has under `skewMs` left.
   * Null when nobody is signed in.
   */
  getAccessToken(options?: { skewMs?: number }): Promise<string | null>;
};

/**
 * Keeps the stored access token usable, called before every Gemini request.
 *
 * Concurrent callers share one refresh: a generation run sends twenty batches
 * at once, and twenty refreshes of the same token would be nineteen wasted
 * round trips at best, and a rate limit at worst.
 *
 * A refresh Google rejects with `invalid_grant` — access revoked from the
 * Google account page, the password changed, the token unused for six months
 * — ends the session, so the app says "sign in again" instead of failing the
 * same way on every call.
 */
export function createTokenRefresher(deps: {
  db: SqlDatabase;
  cipher: Cipher;
  refresh: (refreshToken: string) => Promise<TokenSet>;
  now?: () => number;
}): TokenRefresher {
  const now = deps.now ?? Date.now;
  let inFlight: Promise<string | null> | null = null;

  async function refresh(): Promise<string | null> {
    let refreshToken: string | null;
    try {
      refreshToken = readRefreshToken(deps.db, deps.cipher);
    } catch (error) {
      // The Keychain no longer has the key it was sealed with — reset, or
      // the app was renamed, which changes the Keychain entry's name. The
      // token is unrecoverable; failing the same way on every call helps
      // nobody.
      clearSession(deps.db);
      throw new Error("Your Google sign-in could not be read. Sign in again in Settings.", {
        cause: error,
      });
    }
    if (!refreshToken) return null;

    let tokens: TokenSet;
    try {
      tokens = await deps.refresh(refreshToken);
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === "invalid_grant") {
        clearSession(deps.db);
        throw new Error(
          "Your Google sign-in has expired or was revoked. Sign in again in Settings.",
          { cause: error },
        );
      }
      throw error;
    }

    // The student may have signed out while the request was out.
    const current = readSession(deps.db);
    if (!current) return null;

    saveSession(
      deps.db,
      deps.cipher,
      {
        email: current.email,
        accessToken: tokens.accessToken,
        // Google may rotate the refresh token; keep the old one if it does not.
        refreshToken: tokens.refreshToken ?? refreshToken,
        expiresIn: tokens.expiresIn,
        scope: tokens.scope ?? current.scope,
      },
      now(),
    );
    return tokens.accessToken;
  }

  return {
    async getAccessToken(options) {
      const session = readSession(deps.db);
      if (!session) return null;

      if (!isExpiring(session.accessTokenExpiresAt, now(), options?.skewMs)) {
        return session.accessToken;
      }

      inFlight ??= refresh().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
