/**
 * Backoff tests.
 *
 * The point of retrying is that a 429 is the provider asking to be asked
 * again, not a failure — and the point of *not* retrying everything is that a
 * bad API key retried five times is five times the wait before the same error.
 */
import { describe, expect, it, vi } from "vitest";

import { backoffMs, isRetryable, retryHintMs, withRetry } from "./retry";

const sleep = () => Promise.resolve();

describe("isRetryable", () => {
  it("recognises throttling however the provider phrases it", () => {
    for (const message of [
      "429 Too Many Requests",
      "Rate limit reached for gpt-4.1",
      "RESOURCE_EXHAUSTED: quota exceeded",
      "Overloaded",
      "503 Service Unavailable",
    ]) {
      expect(isRetryable(new Error(message))).toBe(true);
    }
  });

  it("does not retry a mistake retrying cannot fix", () => {
    expect(isRetryable(new Error("401 Invalid API key"))).toBe(false);
    expect(isRetryable(new Error("No Gemini API key."))).toBe(false);
  });
});

describe("backoffMs", () => {
  it("doubles", () => {
    expect(backoffMs(0, () => 0)).toBe(1000);
    expect(backoffMs(1, () => 0)).toBe(2000);
    expect(backoffMs(2, () => 0)).toBe(4000);
  });

  it("adds jitter, so parallel batches do not retry in lockstep", () => {
    expect(backoffMs(0, () => 0.9)).toBeGreaterThan(backoffMs(0, () => 0));
  });
});

describe("withRetry", () => {
  it("succeeds on a later attempt", async () => {
    let calls = 0;
    const work = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error("429 rate limit");
      return "ok";
    });

    await expect(withRetry(work, { sleep })).resolves.toBe("ok");
    expect(work).toHaveBeenCalledTimes(3);
  });

  it("gives up after the last attempt and reports the real error", async () => {
    const work = vi.fn(async () => {
      throw new Error("429 rate limit");
    });

    await expect(withRetry(work, { sleep, attempts: 3 })).rejects.toThrow(/429/);
    expect(work).toHaveBeenCalledTimes(3);
  });

  it("does not retry an error retrying cannot fix", async () => {
    const work = vi.fn(async () => {
      throw new Error("401 Invalid API key");
    });

    await expect(withRetry(work, { sleep })).rejects.toThrow(/401/);
    expect(work).toHaveBeenCalledTimes(1);
  });
});

describe("retryHintMs", () => {
  it("reads the wait a rate-limited provider asks for", () => {
    expect(retryHintMs(new Error('429 RESOURCE_EXHAUSTED {"retryDelay": "23s"}'))).toBe(23_000);
    expect(retryHintMs(new Error("429 Please retry in 7.5s."))).toBe(7_500);
    expect(retryHintMs(new Error("429 Too Many Requests"))).toBeNull();
  });

  it("does not wait out a daily limit", () => {
    expect(retryHintMs(new Error('429 {"retryDelay": "3600s"}'))).toBeNull();
  });

  it("waits at least as long as the hint", async () => {
    const waits: number[] = [];
    let calls = 0;
    await withRetry(
      async () => {
        calls += 1;
        if (calls < 2) throw new Error('429 {"retryDelay": "20s"}');
        return "ok";
      },
      { sleep: async (ms) => void waits.push(ms) },
    );
    expect(waits[0]).toBeGreaterThanOrEqual(20_000);
  });
});
