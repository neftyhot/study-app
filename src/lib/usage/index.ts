/**
 * The usage log: one row per model call, for the student who opts in.
 *
 * Every provider `getProvider` hands out is wrapped here, so all ten
 * features are counted without any of them knowing — they only tag their
 * requests with a `feature`. A row holds numbers: tokens, list-price cost,
 * duration, success. Never a prompt, a reply, or anything from the
 * student's material.
 *
 * Off unless switched on (onboarding, or Settings). Logging must never
 * break the call it is logging, so every write is best-effort.
 */
import { createClient, type Db } from "@/db/client";
import { usageEvents } from "@/db/schema";
import { estimateCost } from "@/lib/llm/pricing";
import type {
  ChatRequest,
  LlmProvider,
  StructuredRequest,
  StructuredResult,
} from "@/lib/llm/types";
import { readSetting, writeSetting } from "@/lib/settings";

export const USAGE_LOGGING_SETTING = "usage_logging";

/** How a call was paid for, so free-quota calls are not read as spend. */
export type AuthMode = "google_oauth" | "api_key" | "env_key" | "local";

export function isUsageLoggingEnabled(db?: Db): boolean {
  return readSetting(USAGE_LOGGING_SETTING, db) === "1";
}

export function setUsageLogging(enabled: boolean, db?: Db) {
  writeSetting(USAGE_LOGGING_SETTING, enabled ? "1" : "0", db);
}

export type UsageRecord = {
  feature: string;
  provider: string;
  model: string;
  authMode: AuthMode;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  success: boolean;
};

/** Writes one row if the student has opted in. Never throws. */
export function recordUsage(record: UsageRecord, db?: Db) {
  try {
    const target = db ?? sharedClient();
    if (!isUsageLoggingEnabled(target)) return;

    target
      .insert(usageEvents)
      .values({
        ...record,
        estimatedCostUsd:
          record.authMode === "local"
            ? 0
            : estimateCost(record.model, {
                inputTokens: record.inputTokens,
                outputTokens: record.outputTokens,
              }),
      })
      .run();
  } catch (error) {
    console.warn(
      `[usage] could not record a ${record.feature} call: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * A provider that records each call it makes.
 *
 * `model` stays a getter through to the real provider: Gemini changes it
 * when it falls back, and the log should name the model that answered.
 */
export function meterProvider(
  provider: LlmProvider,
  authMode: AuthMode,
  db?: Db,
): LlmProvider {
  async function metered<T>(
    feature: string | undefined,
    call: () => Promise<StructuredResult<T>>,
  ): Promise<StructuredResult<T>> {
    const started = Date.now();
    let result: StructuredResult<T> | undefined;
    try {
      result = await call();
      return result;
    } finally {
      recordUsage(
        {
          feature: feature ?? "unknown",
          provider: provider.name,
          model: provider.model,
          authMode,
          inputTokens: result?.usage?.inputTokens ?? 0,
          outputTokens: result?.usage?.outputTokens ?? 0,
          durationMs: Date.now() - started,
          success: result !== undefined,
        },
        db,
      );
    }
  }

  const wrapped: LlmProvider = {
    get name() {
      return provider.name;
    },
    get model() {
      return provider.model;
    },
    get vision() {
      return provider.vision;
    },
    generateStructured<T>(request: StructuredRequest) {
      return metered(request.feature, () => provider.generateStructured<T>(request));
    },
  };

  const chat = provider.generateChat?.bind(provider);
  if (chat) {
    wrapped.generateChat = <T>(request: ChatRequest) =>
      metered(request.feature, () => chat<T>(request));
  }

  return wrapped;
}

let shared: Db | undefined;

/** One connection for logging, rather than one per call. */
function sharedClient(): Db {
  shared ??= createClient();
  return shared;
}
