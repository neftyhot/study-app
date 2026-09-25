/**
 * The PKCE loopback flow, run for real on 127.0.0.1 with the browser and
 * Google's token endpoint played by stand-ins.
 */
import { describe, expect, it, vi } from "vitest";

import {
  GOOGLE_OAUTH_SCOPES,
  missingGeminiScopes,
  GOOGLE_TOKEN_ENDPOINT,
  GoogleOAuthError,
  buildAuthUrl,
  cleanCredential,
  codeChallenge,
  createPkcePair,
  emailFromIdToken,
  refreshAccessToken,
  signInWithGoogle,
} from "./googleOAuth";

const config = { clientId: "client-id.apps.googleusercontent.com", clientSecret: "secret" };

function idToken(claims: object) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.signature`;
}

function tokenEndpoint(body: object, status = 200) {
  return vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

/** Plays the browser: follows the consent URL straight to the redirect. */
function browser(
  redirect: (auth: URL) => Record<string, string>,
  pages: string[] = [],
) {
  return vi.fn(async (url: string) => {
    const auth = new URL(url);
    const target = new URL(auth.searchParams.get("redirect_uri")!);
    for (const [name, value] of Object.entries(redirect(auth))) {
      target.searchParams.set(name, value);
    }
    // Not awaited by the flow, as a real browser would not be.
    void fetch(target).then(async (response) => pages.push(await response.text()));
  });
}

describe("PKCE", () => {
  it("matches the RFC 7636 appendix B example", () => {
    expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("makes a fresh, well-formed verifier every time", () => {
    const a = createPkcePair();
    const b = createPkcePair();

    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.challenge).toBe(codeChallenge(a.verifier));
    expect(a.verifier).not.toBe(b.verifier);
  });

  it("asks for the right scopes, S256, and a refresh token", () => {
    const url = new URL(
      buildAuthUrl({
        clientId: "id",
        redirectUri: "http://127.0.0.1:5000/callback",
        challenge: "challenge",
        state: "state",
      }),
    );

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "id",
      redirect_uri: "http://127.0.0.1:5000/callback",
      response_type: "code",
      code_challenge: "challenge",
      code_challenge_method: "S256",
      state: "state",
      access_type: "offline",
      prompt: "consent",
    });
    expect(url.searchParams.get("scope")!.split(" ")).toEqual([...GOOGLE_OAUTH_SCOPES]);
  });
});

describe("signing in", () => {
  it("runs the loopback round trip and exchanges the code with its verifier", async () => {
    const pages: string[] = [];
    let challenge = "";
    const openExternal = browser((auth) => {
      challenge = auth.searchParams.get("code_challenge")!;
      return { code: "the-code", state: auth.searchParams.get("state")! };
    }, pages);
    const fetchToken = tokenEndpoint({
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3599,
      scope: GOOGLE_OAUTH_SCOPES.join(" "),
      id_token: idToken({ email: "student@gmail.com" }),
    });

    const result = await signInWithGoogle({ config, openExternal, fetch: fetchToken });

    expect(result).toEqual({
      email: "student@gmail.com",
      tokens: expect.objectContaining({
        accessToken: "access",
        refreshToken: "refresh",
        expiresIn: 3599,
      }),
    });

    const redirectUri = new URL(openExternal.mock.calls[0][0]).searchParams.get("redirect_uri")!;
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);

    const [url, init] = fetchToken.mock.calls[0];
    expect(url).toBe(GOOGLE_TOKEN_ENDPOINT);
    const body = new URLSearchParams(init!.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("redirect_uri")).toBe(redirectUri);
    expect(body.get("client_id")).toBe(config.clientId);
    expect(body.get("client_secret")).toBe(config.clientSecret);
    // The verifier sent now is the one the challenge was made from.
    expect(codeChallenge(body.get("code_verifier")!)).toBe(challenge);

    await vi.waitFor(() => expect(pages).toHaveLength(1));
    expect(pages[0]).toContain(
      "Signed in successfully! You can close this tab and return to Megan Study.",
    );

    // The listener is gone once it has its code.
    await expect(fetch(redirectUri)).rejects.toThrow();
  });

  it("rejects a redirect carrying another sign-in's state", async () => {
    const fetchToken = tokenEndpoint({});
    const openExternal = browser(() => ({ code: "the-code", state: "forged" }));

    await expect(
      signInWithGoogle({ config, openExternal, fetch: fetchToken }),
    ).rejects.toMatchObject({ code: "state_mismatch" });
    expect(fetchToken).not.toHaveBeenCalled();
  });

  it("reports a refusal on the consent screen", async () => {
    const pages: string[] = [];
    const openExternal = browser(
      (auth) => ({ error: "access_denied", state: auth.searchParams.get("state")! }),
      pages,
    );

    await expect(
      signInWithGoogle({ config, openExternal, fetch: tokenEndpoint({}) }),
    ).rejects.toMatchObject({ code: "access_denied" });
    await vi.waitFor(() => expect(pages).toHaveLength(1));
    expect(pages[0]).toContain("access was not granted");
  });

  it("gives up when the student never comes back", async () => {
    await expect(
      signInWithGoogle({
        config,
        openExternal: async () => {},
        fetch: tokenEndpoint({}),
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("can be cancelled", async () => {
    const controller = new AbortController();
    const pending = signInWithGoogle({
      config,
      openExternal: async () => controller.abort(),
      fetch: tokenEndpoint({}),
      signal: controller.signal,
    });

    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });

  it("refuses a grant with no refresh token, which would die within the hour", async () => {
    const openExternal = browser((auth) => ({
      code: "c",
      state: auth.searchParams.get("state")!,
    }));

    await expect(
      signInWithGoogle({
        config,
        openExternal,
        fetch: tokenEndpoint({ access_token: "a", expires_in: 3600 }),
      }),
    ).rejects.toMatchObject({ code: "no_refresh_token" });
  });

  it("refuses, and hands back, a grant with the Gemini boxes unticked", async () => {
    const openExternal = browser((auth) => ({
      code: "c",
      state: auth.searchParams.get("state")!,
    }));
    const fetch = tokenEndpoint({
      access_token: "a",
      refresh_token: "r",
      expires_in: 3600,
      scope: "openid https://www.googleapis.com/auth/userinfo.email",
    });

    await expect(signInWithGoogle({ config, openExternal, fetch })).rejects.toMatchObject({
      code: "missing_scope",
    });
    // The partial grant is revoked, so the next sign-in asks for everything.
    expect(fetch.mock.calls.some(([url]) => String(url).includes("revoke"))).toBe(true);
  });

  it("reads which Gemini scopes a grant lacks", () => {
    expect(missingGeminiScopes(GOOGLE_OAUTH_SCOPES.join(" "))).toEqual([]);
    expect(missingGeminiScopes("openid")).toHaveLength(2);
    expect(missingGeminiScopes(undefined)).toEqual([]);
  });
});

describe("refreshing", () => {
  it("posts the refresh token and reads the new access token", async () => {
    const fetchToken = tokenEndpoint({ access_token: "fresh", expires_in: 3599 });

    const tokens = await refreshAccessToken({ config, refreshToken: "r", fetch: fetchToken });

    expect(tokens).toMatchObject({ accessToken: "fresh", expiresIn: 3599 });
    expect(tokens.refreshToken).toBeUndefined();
    const body = new URLSearchParams(fetchToken.mock.calls[0][1]!.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("r");
  });

  it("keeps Google's error code, so a revoked grant can be told apart", async () => {
    const fetchToken = tokenEndpoint(
      { error: "invalid_grant", error_description: "Token has been expired or revoked." },
      400,
    );

    const error = await refreshAccessToken({ config, refreshToken: "r", fetch: fetchToken }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(GoogleOAuthError);
    expect(error).toMatchObject({ code: "invalid_grant" });
    expect((error as Error).message).toContain("expired or revoked");
  });
});

describe("the token request", () => {
  function sentBody(fetchToken: ReturnType<typeof tokenEndpoint>, call = 0) {
    const init = fetchToken.mock.calls[call][1]!;
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
    return new URLSearchParams(init.body as string);
  }

  it("strips whitespace and stray quotes from the client credentials", async () => {
    expect(cleanCredential('  "abc.apps.googleusercontent.com"\n')).toBe(
      "abc.apps.googleusercontent.com",
    );
    expect(cleanCredential(" 'GOCSPX-x' ")).toBe("GOCSPX-x");
    expect(cleanCredential(undefined)).toBe("");

    const fetchToken = tokenEndpoint({ access_token: "a", expires_in: 3600 });
    await refreshAccessToken({
      config: { clientId: ' "id" ', clientSecret: "'secret'\n" },
      refreshToken: "r",
      fetch: fetchToken,
    });

    const body = sentBody(fetchToken);
    expect(body.get("client_id")).toBe("id");
    expect(body.get("client_secret")).toBe("secret");
  });

  it("leaves client_secret out entirely when there is none", async () => {
    const fetchToken = tokenEndpoint({ access_token: "a", expires_in: 3600 });
    await refreshAccessToken({
      config: { clientId: "id", clientSecret: "  " },
      refreshToken: "r",
      fetch: fetchToken,
    });

    expect(sentBody(fetchToken).has("client_secret")).toBe(false);
  });

  it("retries once without the secret when Google rejects the client", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchToken = vi
      .fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        Response.json(
          { error: "invalid_client", error_description: "Unauthorized" },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ access_token: "a", expires_in: 3600 }));

    try {
      const tokens = await refreshAccessToken({
        config,
        refreshToken: "r",
        fetch: fetchToken,
      });

      expect(tokens.accessToken).toBe("a");
      expect(sentBody(fetchToken, 0).get("client_secret")).toBe("secret");
      expect(sentBody(fetchToken, 1).has("client_secret")).toBe(false);
      expect(sentBody(fetchToken, 1).get("refresh_token")).toBe("r");
      expect(error).toHaveBeenCalledWith(
        "[google-auth] Token exchange failed:",
        401,
        expect.stringContaining("invalid_client"),
      );
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("reports the rejected secret, not the retry's \"client_secret is missing\"", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchToken = vi
      .fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        Response.json(
          { error: "invalid_client", error_description: "Unauthorized" },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          { error: "invalid_request", error_description: "client_secret is missing." },
          { status: 400 },
        ),
      );

    try {
      const failure = await refreshAccessToken({
        config,
        refreshToken: "r",
        fetch: fetchToken,
      }).catch((caught: unknown) => caught);

      expect(failure).toMatchObject({ code: "invalid_client" });
      expect((failure as Error).message).toContain("Unauthorized");
      // Both answers are in the log, each once.
      expect(error).toHaveBeenCalledTimes(2);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("logs Google's raw answer when the request fails for good", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchToken = vi
      .fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response("<html>Bad Gateway</html>", { status: 502 }));

    try {
      await expect(
        refreshAccessToken({ config, refreshToken: "r", fetch: fetchToken }),
      ).rejects.toMatchObject({ code: "http_502" });
      expect(fetchToken).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(
        "[google-auth] Token exchange failed:",
        502,
        "<html>Bad Gateway</html>",
      );
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("the ID token", () => {
  it("yields the signed-in address", () => {
    expect(emailFromIdToken(idToken({ email: "student@gmail.com" }))).toBe(
      "student@gmail.com",
    );
  });

  it("yields nothing from something that is not a JWT", () => {
    expect(emailFromIdToken("nonsense")).toBeNull();
    expect(emailFromIdToken("a.!!!.c")).toBeNull();
    expect(emailFromIdToken(idToken({ sub: "123" }))).toBeNull();
  });
});
