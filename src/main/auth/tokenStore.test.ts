/**
 * Token storage and refresh, against a real (in-memory) database migrated
 * like the app's, with a stand-in for Electron's `safeStorage`.
 */
import Database from "better-sqlite3";
import { GOOGLE_OAUTH_SCOPES } from "./googleOAuth";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { googleAccessToken, readGoogleSession } from "@/lib/auth/google-session";
import { LlmError } from "@/lib/llm/types";

import { GoogleOAuthError, type TokenSet } from "./googleOAuth";
import { GOOGLE_AUTH_BRIDGE_KEY } from "./ipc";
import {
  EXPIRY_SKEW_MS,
  clearSession,
  createTokenRefresher,
  isExpiring,
  readRefreshToken,
  readSession,
  saveSession,
  sessionStatus,
  type Cipher,
} from "./tokenStore";

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

/** Reversible, and visibly not the plaintext — enough to prove the plumbing. */
function fakeCipher(available = true): Cipher {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from(`sealed:${[...text].reverse().join("")}`),
    decryptString: (buffer) => {
      const text = buffer.toString();
      if (!text.startsWith("sealed:")) throw new Error("not ours");
      return [...text.slice("sealed:".length)].reverse().join("");
    },
  };
}

const cipher = fakeCipher();
const NOW = 1_800_000_000_000;

function signIn(overrides: Partial<Parameters<typeof saveSession>[2]> = {}, now = NOW) {
  saveSession(
    sqlite,
    cipher,
    {
      email: "student@gmail.com",
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresIn: 3600,
      scope: "openid",
      ...overrides,
    },
    now,
  );
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
});

describe("saving a session", () => {
  it("round-trips everything but never stores the refresh token in the clear", () => {
    signIn();

    expect(readSession(sqlite)).toEqual({
      email: "student@gmail.com",
      accessToken: "access-1",
      accessTokenExpiresAt: NOW + 3_600_000,
      scope: "openid",
    });
    expect(readRefreshToken(sqlite, cipher)).toBe("refresh-1");

    const raw = sqlite
      .prepare("SELECT refresh_token_encrypted FROM google_oauth_sessions")
      .get() as { refresh_token_encrypted: string };
    expect(raw.refresh_token_encrypted).not.toContain("refresh-1");
    expect(Buffer.from(raw.refresh_token_encrypted, "base64").toString()).toMatch(
      /^sealed:/,
    );
  });

  it("refuses to save when the OS offers no encryption", () => {
    expect(() =>
      saveSession(sqlite, fakeCipher(false), {
        email: null,
        accessToken: "a",
        refreshToken: "r",
        expiresIn: 3600,
      }),
    ).toThrow(/secure storage/);
    expect(readSession(sqlite)).toBeNull();
  });

  it("replaces an earlier sign-in instead of keeping two", () => {
    signIn();
    signIn({ email: "other@gmail.com", refreshToken: "refresh-2" });

    const count = sqlite
      .prepare("SELECT count(*) AS n FROM google_oauth_sessions")
      .get() as { n: number };
    expect(count.n).toBe(1);
    expect(sessionStatus(sqlite)).toEqual({
      connected: true,
      email: "other@gmail.com",
    });
    expect(readRefreshToken(sqlite, cipher)).toBe("refresh-2");
  });

  it("signing out removes every trace", () => {
    signIn();
    clearSession(sqlite);

    expect(readSession(sqlite)).toBeNull();
    expect(readRefreshToken(sqlite, cipher)).toBeNull();
    expect(sessionStatus(sqlite)).toEqual({ connected: false });
  });
});

describe("expiry", () => {
  it("counts a token with a minute or less left as expired", () => {
    expect(EXPIRY_SKEW_MS).toBe(60_000);
    expect(isExpiring(NOW + 61_000, NOW)).toBe(false);
    expect(isExpiring(NOW + 60_000, NOW)).toBe(true);
    expect(isExpiring(NOW + 1_000, NOW)).toBe(true);
    expect(isExpiring(NOW - 1_000, NOW)).toBe(true);
  });
});

describe("the refresher", () => {
  function refresher(
    refresh: (token: string) => Promise<TokenSet>,
    now = () => NOW,
  ) {
    return createTokenRefresher({ db: sqlite, cipher, refresh, now });
  }

  it("returns null, and calls nothing, when nobody is signed in", async () => {
    const refresh = vi.fn();
    expect(await refresher(refresh).getAccessToken()).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("hands back the stored token while it has more than a minute left", async () => {
    signIn();
    const refresh = vi.fn();

    const token = await refresher(refresh, () => NOW + 3_600_000 - 61_000).getAccessToken();

    expect(token).toBe("access-1");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes within 60 seconds of expiry, and saves the result", async () => {
    signIn();
    const later = NOW + 3_600_000 - 30_000;
    const refresh = vi.fn(async () => ({
      accessToken: "access-2",
      expiresIn: 3599,
      scope: "openid email",
    }));

    const token = await refresher(refresh, () => later).getAccessToken();

    expect(refresh).toHaveBeenCalledWith("refresh-1");
    expect(token).toBe("access-2");
    expect(readSession(sqlite)).toEqual({
      email: "student@gmail.com",
      accessToken: "access-2",
      accessTokenExpiresAt: later + 3_599_000,
      scope: "openid email",
    });
    // Google did not rotate it, so the original is kept.
    expect(readRefreshToken(sqlite, cipher)).toBe("refresh-1");
  });

  it("refreshes a token that has already expired", async () => {
    signIn({ expiresIn: 10 });
    const refresh = vi.fn(async () => ({ accessToken: "access-2", expiresIn: 3600 }));

    expect(await refresher(refresh, () => NOW + 3_600_000).getAccessToken()).toBe(
      "access-2",
    );
  });

  it("stores a rotated refresh token, encrypted", async () => {
    signIn({ expiresIn: 0 });
    const refresh = vi.fn(async () => ({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      expiresIn: 3600,
    }));

    await refresher(refresh).getAccessToken();

    expect(readRefreshToken(sqlite, cipher)).toBe("refresh-2");
    const raw = sqlite
      .prepare("SELECT refresh_token_encrypted FROM google_oauth_sessions")
      .get() as { refresh_token_encrypted: string };
    expect(raw.refresh_token_encrypted).not.toContain("refresh-2");
  });

  it("honours a wider margin when asked for one", async () => {
    signIn();
    const refresh = vi.fn(async () => ({ accessToken: "access-2", expiresIn: 3600 }));
    const tenMinutesLeft = () => NOW + 3_600_000 - 10 * 60_000;

    expect(await refresher(refresh, tenMinutesLeft).getAccessToken()).toBe("access-1");
    expect(
      await refresher(refresh, tenMinutesLeft).getAccessToken({ skewMs: 15 * 60_000 }),
    ).toBe("access-2");
  });

  it("shares one refresh between concurrent callers", async () => {
    signIn({ expiresIn: 0 });
    let release!: () => void;
    const refresh = vi.fn(
      () =>
        new Promise<TokenSet>((resolve) => {
          release = () => resolve({ accessToken: "access-2", expiresIn: 3600 });
        }),
    );
    const store = refresher(refresh);

    const calls = Array.from({ length: 20 }, () => store.getAccessToken());
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    release();

    expect(await Promise.all(calls)).toEqual(Array(20).fill("access-2"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("tries again on the next call after a failed refresh", async () => {
    signIn({ expiresIn: 0 });
    const refresh = vi
      .fn<(token: string) => Promise<TokenSet>>()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ accessToken: "access-2", expiresIn: 3600 });
    const store = refresher(refresh);

    await expect(store.getAccessToken()).rejects.toThrow("network down");
    // A transient failure must not sign the student out.
    expect(readSession(sqlite)?.accessToken).toBe("access-1");

    expect(await store.getAccessToken()).toBe("access-2");
  });

  it("ends the session when Google says the grant is gone", async () => {
    signIn({ expiresIn: 0 });
    const refresh = vi.fn(async () => {
      throw new GoogleOAuthError("invalid_grant", "Token has been expired or revoked.");
    });

    await expect(refresher(refresh).getAccessToken()).rejects.toThrow(/Sign in again/);
    expect(readSession(sqlite)).toBeNull();
  });

  it("does not bring back a session signed out during the refresh", async () => {
    signIn({ expiresIn: 0 });
    const refresh = vi.fn(async () => {
      clearSession(sqlite);
      return { accessToken: "access-2", expiresIn: 3600 };
    });

    expect(await refresher(refresh).getAccessToken()).toBeNull();
    expect(readSession(sqlite)).toBeNull();
  });
});

describe("the web server's side", () => {
  const key = Symbol.for(GOOGLE_AUTH_BRIDGE_KEY);
  const globals = globalThis as Record<symbol, unknown>;

  it("reports who is signed in, and never a token", () => {
    expect(readGoogleSession(db)).toBeNull();
    signIn();
    // The fixture grants only "openid": signed in, but Gemini would refuse.
    expect(readGoogleSession(db)).toEqual({ email: "student@gmail.com", missingScopes: true });

    signIn({ scope: GOOGLE_OAUTH_SCOPES.join(" ") });
    expect(readGoogleSession(db)).toEqual({ email: "student@gmail.com", missingScopes: false });
  });

  it("asks the main process for a token when it is in the same process", async () => {
    const getAccessToken = vi.fn(async () => "from-main");
    globals[key] = { getAccessToken };
    try {
      expect(await googleAccessToken(db)).toBe("from-main");
      expect(getAccessToken).toHaveBeenCalledTimes(1);
    } finally {
      delete globals[key];
    }
  });

  it("reports a failed refresh as a model error the UI already shows", async () => {
    globals[key] = {
      getAccessToken: async () => {
        throw new Error("Your Google sign-in has expired or was revoked.");
      },
    };
    try {
      await expect(googleAccessToken(db)).rejects.toBeInstanceOf(LlmError);
    } finally {
      delete globals[key];
    }
  });

  it("without the main process, uses the stored token only while it is fresh", async () => {
    await expect(googleAccessToken(db)).rejects.toThrow(/Not signed in/);

    signIn({}, Date.now());
    expect(await googleAccessToken(db)).toBe("access-1");

    signIn({ expiresIn: 30 }, Date.now());
    await expect(googleAccessToken(db)).rejects.toThrow(/cannot refresh/);
  });
});
