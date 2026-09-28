/**
 * A chain of models, so one that is busy, retired or out of quota does not
 * stop the student.
 *
 * The first provider is the model they chose; the rest are cheaper models from
 * the same provider, on the same key, tried in order. Only failures another
 * model could fix move down the chain — a bad key or a malformed request
 * fails the same way everywhere and is thrown at once.
 */
import { LlmError, type LlmProvider, type StructuredResult } from "./types";

export type FailureKind =
  /** Out of quota or credit: billing, or waiting, fixes it. */
  | "limit"
  /** A per-minute rate limit: waiting a moment fixes it. */
  | "rate"
  /** This key cannot use this model at all. */
  | "unavailable"
  /** The provider is overloaded or erroring; try again or elsewhere. */
  | "busy";

function text(error: unknown): string {
  const own = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  const inner = cause instanceof Error ? cause.message : cause ? String(cause) : "";
  const status = (error as { status?: unknown })?.status ?? (cause as { status?: unknown })?.status;
  return `${own} ${inner} ${status ?? ""}`;
}

/** What went wrong, where another model or a billing change could help. */
export function classifyFailure(error: unknown): FailureKind | null {
  const message = text(error);

  if (error instanceof LlmError && error.kind === "limit") return "limit";
  if (error instanceof LlmError && error.kind === "unavailable") return "unavailable";

  // Zero quota means the model is not on this key's plan (Pro on a free key).
  if (/limit:\s*0\b/.test(message)) return "unavailable";
  if (/model_not_found|does not exist|not_found_error|\b404\b|NOT_FOUND/i.test(message) && /model/i.test(message)) {
    return "unavailable";
  }
  if (/credit balance|credit_balance|insufficient_quota|billing|\b402\b|PerDay|per day|daily/i.test(message)) {
    return "limit";
  }
  if (/\b429\b|RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(message)) return "rate";
  if (/\b(500|502|503|504|529)\b|UNAVAILABLE|overloaded|INTERNAL|timed? ?out|ECONNRESET|fetch failed/i.test(message)) {
    return "busy";
  }
  return null;
}

export type ChainOptions = {
  /**
   * Whether a per-minute rate limit moves to the next model. Yes for a
   * student waiting on an answer; no for deck generation, which backs off
   * and keeps the better model rather than finishing on a worse one.
   */
  fallBackOnRate?: boolean;
  /** Injected in tests so they do not wait. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function providerChain(chain: LlmProvider[], options: ChainOptions = {}): LlmProvider {
  if (chain.length === 1) return chain[0];
  const [first] = chain;
  const sleep = options.sleep ?? defaultSleep;
  const fallBackOnRate = options.fallBackOnRate ?? true;
  /** Models this key cannot use; skipped for the rest of this chain's life. */
  const closed = new Set<number>();
  let answered = first;

  async function run<T>(
    call: (provider: LlmProvider) => Promise<StructuredResult<T>> | undefined,
  ): Promise<StructuredResult<T>> {
    let firstError: unknown;
    let sawLimit = false;

    for (let index = 0; index < chain.length; index += 1) {
      if (closed.has(index) && index < chain.length - 1) continue;
      const provider = chain[index];

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const pending = call(provider);
          if (!pending) break; // This model cannot do it (no chat); try the next.
          const result = await pending;
          answered = provider;
          return result;
        } catch (error) {
          firstError ??= error;
          const kind = classifyFailure(error);
          if (!kind) throw error;
          if (kind === "limit") sawLimit = true;
          if (kind === "rate" && !fallBackOnRate) throw error;
          if (kind === "unavailable") closed.add(index);
          // A busy server usually answers a second time; anything else will not.
          if (kind === "busy" && attempt === 0) {
            await sleep(1200);
            continue;
          }
          if (index < chain.length - 1) {
            console.warn(`[llm] ${provider.model} failed (${kind}); trying ${chain[index + 1].model}.`);
          }
          break;
        }
      }
    }

    const kind = classifyFailure(firstError);
    if (sawLimit || kind === "limit" || kind === "rate") {
      throw new LlmError(
        `You've reached your ${label(first.name)} usage limit on every model it offers. Wait a minute and try again, or add billing to raise the limit (Settings → AI model → Upgrade).`,
        firstError,
        "limit",
      );
    }
    throw firstError instanceof Error ? firstError : new LlmError(String(firstError));
  }

  return {
    get name() {
      return first.name;
    },
    // The model that last answered, so the usage log prices the right one.
    get model() {
      return answered.model;
    },
    get vision() {
      return first.vision;
    },
    generateStructured<T>(request: Parameters<LlmProvider["generateStructured"]>[0]) {
      return run<T>((provider) => provider.generateStructured<T>(request));
    },
    generateChat: first.generateChat
      ? <T,>(request: Parameters<NonNullable<LlmProvider["generateChat"]>>[0]) =>
          run<T>((provider) => provider.generateChat?.<T>(request))
      : undefined,
  };
}

function label(name: string) {
  return name === "gemini" ? "Gemini" : name === "openai" ? "OpenAI" : name === "anthropic" ? "Claude" : name;
}
