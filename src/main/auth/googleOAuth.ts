/**
 * "Sign in with Google" for the desktop app: OAuth 2.0 for installed apps,
 * with PKCE (RFC 7636) and a loopback redirect (RFC 8252).
 *
 * Runs in the Electron main process. The flow:
 *
 *  1. Make a random `code_verifier` and its SHA-256 `code_challenge`.
 *  2. Listen on 127.0.0.1 on a port the OS picks, and open Google's consent
 *     page in the student's own browser with that port as the redirect.
 *  3. Google redirects back to /callback with a `code`; answer with a page
 *     telling them to go back to the app, and stop listening.
 *  4. Trade the code, plus the verifier only this process ever saw, for
 *     tokens.
 *
 * The student's own browser rather than a window inside the app: Google
 * refuses sign-in from embedded webviews, and a student is right to be wary
 * of typing a Google password into anything else.
 *
 * Nothing here imports Electron. `shell.openExternal` and `fetch` are handed
 * in, so the whole flow can be exercised without a browser or a network.
 * No relative runtime imports either: Electron loads this file directly in
 * development, stripping the types, and that loader does not resolve
 * extensionless paths.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/generative-language.peruserquota",
  // GenerateContent on the Gemini API is refused without this one.
  "https://www.googleapis.com/auth/generative-language.retriever",
] as const;

/**
 * The scopes Gemini calls actually need. Google's consent screen lets a
 * person untick individual permissions, and a sign-in without these looks
 * connected but fails every generation with ACCESS_TOKEN_SCOPE_INSUFFICIENT.
 */
export const GEMINI_SCOPES = [
  "https://www.googleapis.com/auth/generative-language.peruserquota",
  "https://www.googleapis.com/auth/generative-language.retriever",
] as const;

/** Which Gemini scopes a granted-scope string lacks. Unknown (no string) is trusted. */
export function missingGeminiScopes(granted: string | null | undefined): string[] {
  if (!granted) return [];
  const have = new Set(granted.split(/\s+/));
  return GEMINI_SCOPES.filter((scope) => !have.has(scope));
}

export const MISSING_SCOPE_MESSAGE =
  "Google didn't give Megan Study permission to use Gemini. Sign in again, and on Google's permissions screen tick every box (or \"Select all\") before pressing Continue.";

/** How long the loopback server waits for the student to finish in the browser. */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

export type OAuthClientConfig = {
  clientId: string;
  /**
   * Google requires the secret even for a Desktop client using PKCE. It is
   * not a secret in any meaningful sense once it ships inside an app — Google
   * says as much for installed apps — and PKCE is what actually protects the
   * code in transit.
   */
  clientSecret: string;
};

export type TokenSet = {
  accessToken: string;
  /** Present on the first exchange; a refresh usually omits it. */
  refreshToken?: string;
  /** Seconds, as Google reports it. */
  expiresIn: number;
  scope?: string;
  idToken?: string;
};

export type SignInResult = {
  tokens: TokenSet & { refreshToken: string };
  email: string | null;
};

type FetchLike = typeof fetch;

/**
 * An error from Google's token endpoint, keeping its `error` code.
 *
 * `invalid_grant` on a refresh means the student revoked access or the token
 * aged out; the token store keys off `code` to forget the session instead of
 * retrying it forever.
 */
export class GoogleOAuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GoogleOAuthError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------- PKCE */

/**
 * A PKCE pair. 32 random bytes encode to a 43-character base64url verifier,
 * the minimum RFC 7636 allows and all the entropy it asks for.
 */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: codeChallenge(verifier) };
}

/** `BASE64URL(SHA256(ASCII(code_verifier)))` — the S256 method. */
export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function buildAuthUrl(options: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: "code",
    scope: (options.scopes ?? GOOGLE_OAUTH_SCOPES).join(" "),
    code_challenge: options.challenge,
    code_challenge_method: "S256",
    state: options.state,
    // Without both, a second sign-in on the same account comes back with no
    // refresh token, and the session dies an hour later.
    access_type: "offline",
    prompt: "consent",
  }).toString();
  return url.toString();
}

/* ---------------------------------------------------------------- Sign in */

/**
 * Runs the whole browser round trip and resolves with the tokens.
 *
 * Rejects if the student denies access, closes the tab and lets it time out,
 * or `signal` aborts (a second click on the button, the app quitting).
 */
export async function signInWithGoogle(options: {
  config: OAuthClientConfig;
  openExternal: (url: string) => Promise<void>;
  fetch?: FetchLike;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<SignInResult> {
  const { config } = options;
  const fetchImpl = options.fetch ?? fetch;
  const { verifier, challenge } = createPkcePair();
  const state = randomBytes(16).toString("base64url");

  const callback = await listenForCallback({
    state,
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? SIGN_IN_TIMEOUT_MS,
  });

  try {
    await options.openExternal(
      buildAuthUrl({
        clientId: config.clientId,
        redirectUri: callback.redirectUri,
        challenge,
        state,
      }),
    );
  } catch (error) {
    callback.close();
    throw error;
  }

  const code = await callback.code;

  const tokens = await exchangeCode({
    config,
    code,
    verifier,
    redirectUri: callback.redirectUri,
    fetch: fetchImpl,
  });

  if (!tokens.refreshToken) {
    // With access_type=offline and prompt=consent Google always sends one;
    // without it the session would silently end within the hour.
    throw new GoogleOAuthError(
      "no_refresh_token",
      "Google did not return a refresh token. Try signing in again.",
    );
  }

  if (missingGeminiScopes(tokens.scope).length > 0) {
    // A half grant is worse than none: it would look connected and fail
    // every generation. Hand it back so the next sign-in asks afresh.
    await revokeToken(tokens.refreshToken, fetchImpl).catch(() => undefined);
    throw new GoogleOAuthError("missing_scope", MISSING_SCOPE_MESSAGE);
  }

  return {
    tokens: { ...tokens, refreshToken: tokens.refreshToken },
    email: tokens.idToken ? emailFromIdToken(tokens.idToken) : null,
  };
}

type Callback = {
  redirectUri: string;
  code: Promise<string>;
  close: () => void;
};

/**
 * Listens on an ephemeral loopback port for exactly one redirect.
 *
 * Bound to 127.0.0.1 and not `localhost`, so it cannot land on an IPv6
 * interface the redirect URI does not name, and never on anything reachable
 * from another machine.
 */
export function listenForCallback(options: {
  state: string;
  signal?: AbortSignal;
  timeoutMs: number;
}): Promise<Callback> {
  return new Promise((resolveListening, rejectListening) => {
    if (options.signal?.aborted) {
      rejectListening(new GoogleOAuthError("cancelled", "Sign-in was cancelled."));
      return;
    }

    let settle: { resolve: (code: string) => void; reject: (error: Error) => void };
    const code = new Promise<string>((resolve, reject) => {
      settle = { resolve, reject };
    });
    // Nobody may be awaiting `code` yet when an abort lands.
    code.catch(() => {});

    let done = false;
    const finish = (outcome: { code: string } | { error: Error }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      server.close();
      server.closeAllConnections();
      if ("code" in outcome) settle.resolve(outcome.code);
      else settle.reject(outcome.error);
    };

    const server = createServer((request, response) => {
      const result = readCallback(request, options.state);
      if (!result) {
        // A favicon request, or anything else a browser tries; not ours.
        response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
        return;
      }

      if ("error" in result) {
        respond(response, 400, `Sign-in did not complete: ${result.error}. You can close this tab and try again from Megan Study.`);
        finish({ error: new GoogleOAuthError(result.errorCode, result.error) });
      } else {
        respond(response, 200, "Signed in successfully! You can close this tab and return to Megan Study.");
        finish({ code: result.code });
      }
    });

    const timer = setTimeout(
      () =>
        finish({
          error: new GoogleOAuthError("timeout", "Sign-in timed out. Try again."),
        }),
      options.timeoutMs,
    );
    const onAbort = () =>
      finish({
        error: new GoogleOAuthError("cancelled", "Sign-in was cancelled."),
      });
    options.signal?.addEventListener("abort", onAbort, { once: true });

    server.on("error", (error) => {
      clearTimeout(timer);
      rejectListening(error);
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolveListening({
        redirectUri: `http://127.0.0.1:${port}/callback`,
        code,
        close: () =>
          finish({
            error: new GoogleOAuthError("cancelled", "Sign-in was cancelled."),
          }),
      });
    });
  });
}

function readCallback(
  request: IncomingMessage,
  expectedState: string,
): { code: string } | { errorCode: string; error: string } | null {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method !== "GET" || url.pathname !== "/callback") return null;

  const params = url.searchParams;
  const error = params.get("error");
  if (error) {
    return {
      errorCode: error,
      error: error === "access_denied" ? "access was not granted" : error,
    };
  }

  // A redirect carrying someone else's state is not the one this sign-in
  // started — another page, or another attempt, poking the port.
  if (params.get("state") !== expectedState) {
    return { errorCode: "state_mismatch", error: "the response did not match this sign-in" };
  }

  const code = params.get("code");
  if (!code) return { errorCode: "no_code", error: "Google sent no authorization code" };
  return { code };
}

function respond(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "close",
  });
  response.end(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Megan Study</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 16px/1.5 system-ui, -apple-system, sans-serif; padding: 16px; }
  p { max-width: 28rem; text-align: center; }
</style>
</head>
<body><p>${escapeHtml(message)}</p></body>
</html>`);
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/* ----------------------------------------------------------------- Tokens */

export async function exchangeCode(options: {
  config: OAuthClientConfig;
  code: string;
  verifier: string;
  redirectUri: string;
  fetch?: FetchLike;
}): Promise<TokenSet> {
  return postToken(options.fetch ?? fetch, options.config, {
    code: options.code,
    code_verifier: options.verifier,
    grant_type: "authorization_code",
    redirect_uri: options.redirectUri,
  });
}

export async function refreshAccessToken(options: {
  config: OAuthClientConfig;
  refreshToken: string;
  fetch?: FetchLike;
}): Promise<TokenSet> {
  return postToken(options.fetch ?? fetch, options.config, {
    refresh_token: options.refreshToken,
    grant_type: "refresh_token",
  });
}

/**
 * Tells Google to forget the grant. Best effort: signing out must still
 * clear the local session when the network is down.
 */
export async function revokeToken(token: string, fetchImpl: FetchLike = fetch) {
  try {
    await fetchImpl(GOOGLE_REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    // Offline; the local session is cleared regardless.
  }
}

/**
 * A credential as it should be sent: no surrounding whitespace, and no
 * quotes that came along from an env file or a copy-paste. Either one makes
 * Google answer `invalid_client` with nothing to say which character is wrong.
 */
export function cleanCredential(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
}

/** Google's error bodies carry a code and a description, never a token. */
function logFailure(result: { response: Response; text: string; payload: TokenPayload }) {
  if (result.response.ok && result.payload.access_token) return;
  console.error("[google-auth] Token exchange failed:", result.response.status, result.text);
}

type TokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

async function postToken(
  fetchImpl: FetchLike,
  config: OAuthClientConfig,
  grant: Record<string, string>,
): Promise<TokenSet> {
  const clientId = cleanCredential(config.clientId);
  const clientSecret = cleanCredential(config.clientSecret);

  const send = async (withSecret: boolean) => {
    const body = new URLSearchParams({ client_id: clientId, ...grant });
    if (withSecret) body.set("client_secret", clientSecret);

    const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const text = await response.text();
    let payload: TokenPayload = {};
    try {
      payload = JSON.parse(text) as TokenPayload;
    } catch {
      // Not JSON (an HTML error page); the raw text is logged below.
    }
    return { response, text, payload };
  };

  // The secret is sent only when there is one.
  // The secret is sent only when there is one.
  let result = await send(clientSecret.length > 0);
  logFailure(result);

  // PKCE already proves this app started the sign-in, and some client types
  // accept the exchange without a secret — so a secret Google rejects gets
  // one retry without it before the sign-in is declared failed.
  if (result.payload.error === "invalid_client" && clientSecret.length > 0) {
    console.warn("[google-auth] Retrying without client_secret.");
    const retry = await send(false);
    logFailure(retry);
    // A Desktop client answers the retry with "client_secret is missing",
    // which hides the real problem: the secret sent first was rejected.
    // Report that one unless the retry actually worked.
    if (retry.response.ok && retry.payload.access_token) result = retry;
  }

  const { response, payload } = result;
  if (!response.ok || !payload.access_token) {
    const code = payload.error ?? `http_${response.status}`;
    throw new GoogleOAuthError(
      code,
      `Google token request failed: ${payload.error_description ?? code}`,
    );
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: Number(payload.expires_in ?? 3600),
    scope: payload.scope,
    idToken: payload.id_token,
  };
}

/**
 * The signed-in address, read from the ID token's payload.
 *
 * Not signature-checked, and it need not be: the token came straight from
 * Google's token endpoint over TLS, which OpenID Connect Core §3.1.3.7
 * accepts in place of validation. It is only ever used as a label.
 */
export function emailFromIdToken(idToken: string): string | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: unknown;
    };
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}
