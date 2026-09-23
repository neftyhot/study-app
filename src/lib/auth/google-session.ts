/**
 * The web server's view of "Sign in with Google".
 *
 * The Electron main process signs in, owns the refresh token, and is the only
 * thing that can decrypt it. This side only needs two answers: is someone
 * signed in (and as whom), and what access token should this Gemini call
 * carry.
 *
 * For the token it asks the main process first, through the in-process
 * bridge the packaged app registers — that path refreshes through the
 * keychain when the token is within a minute of expiring. With no bridge
 * (`next dev` in its own process) it reads the stored token, which the
 * development main process keeps fresh on a timer.
 */
import { eq } from "drizzle-orm";

import { createClient, type Db } from "@/db/client";
import { googleOAuthSessions } from "@/db/schema";
import { LlmError } from "@/lib/llm/types";
import { GOOGLE_AUTH_BRIDGE_KEY, type GoogleAuthBridge } from "@/main/auth/ipc";
import { missingGeminiScopes } from "@/main/auth/googleOAuth";
import { isExpiring } from "@/main/auth/tokenStore";

const SESSION_ID = "default";

export type GoogleSessionSummary = {
  email: string | null;
  /** Signed in, but without the Gemini permissions: every call will fail. */
  missingScopes: boolean;
};

function row(db?: Db) {
  try {
    return (
      (db ?? createClient())
        .select()
        .from(googleOAuthSessions)
        .where(eq(googleOAuthSessions.id, SESSION_ID))
        .get() ?? null
    );
  } catch {
    // Unmigrated database: nobody is signed in.
    return null;
  }
}

/** Who is signed in, without any token. Safe to hand to the browser. */
export function readGoogleSession(db?: Db): GoogleSessionSummary | null {
  const session = row(db);
  return session
    ? { email: session.email, missingScopes: missingGeminiScopes(session.scope).length > 0 }
    : null;
}

export function hasGoogleSession(db?: Db): boolean {
  return row(db) !== null;
}

function bridge(): GoogleAuthBridge | undefined {
  return (globalThis as Record<symbol, GoogleAuthBridge | undefined>)[
    Symbol.for(GOOGLE_AUTH_BRIDGE_KEY)
  ];
}

/**
 * An access token for a Gemini call, good for at least another minute.
 *
 * Called per request rather than once per provider: a generation run can
 * outlast the hour a token is good for.
 */
export async function googleAccessToken(db?: Db): Promise<string> {
  const main = bridge();

  if (main) {
    let token: string | null;
    try {
      token = await main.getAccessToken();
    } catch (error) {
      throw new LlmError(
        error instanceof Error ? error.message : String(error),
        error,
      );
    }
    if (!token) throw new LlmError(SIGNED_OUT);
    return token;
  }

  const session = row(db);
  if (!session) throw new LlmError(SIGNED_OUT);

  if (isExpiring(session.accessTokenExpiresAt)) {
    throw new LlmError(
      "The Google sign-in token has expired and this server cannot refresh it. Keep the desktop app open (it renews the token), or sign in again in Settings.",
    );
  }
  return session.accessToken;
}

const SIGNED_OUT =
  "Not signed in with Google. Sign in again in Settings, or add a Gemini API key.";
