/**
 * Retrying a rate-limited request.
 *
 * Five requests in flight will hit a per-minute quota on almost any plan, and
 * a 429 is not a failure — it is the provider asking to be asked again in a
 * moment. Backing off exponentially with jitter is the difference between a
 * run that finishes and a run that dies two batches in.
 *
 * Only retryable failures are retried. A bad API key retried four times is
 * four times the wait before the same error.
 */
export const MAX_ATTEMPTS = 5;
export const BASE_DELAY_MS = 1_000;

/** Reads as throttling, not as a mistake we made. */
export function isRetryable(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  return (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("rate_limit") ||
    message.includes("quota") ||
    message.includes("resource_exhausted") ||
    message.includes("overloaded") ||
    message.includes("503") ||
    message.includes("service unavailable") ||
    message.includes("econnreset") ||
    message.includes("etimedout")
  );
}

/** Doubling, with jitter so five parallel batches do not retry in lockstep. */
export function backoffMs(attempt: number, random = Math.random): number {
  return BASE_DELAY_MS * 2 ** attempt + Math.floor(random() * 250);
}

export type RetryOptions = {
  attempts?: number;
  /** Injected in tests so they do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
};

export async function withRetry<T>(
  work: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? MAX_ATTEMPTS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= attempts - 1 || !isRetryable(error)) throw error;

      const delay = backoffMs(attempt);
      options.onRetry?.(attempt + 1, delay, error);
      await sleep(delay);
    }
  }
}
