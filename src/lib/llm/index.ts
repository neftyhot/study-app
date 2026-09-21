import { googleAccessToken, hasGoogleSession } from "@/lib/auth/google-session";
import {
  readApiKey,
  readDownload,
  readLocalModel,
  readProvider,
  type ProviderId,
} from "@/lib/settings";

import { createAnthropicProvider } from "./anthropic";
import {
  createGeminiProvider,
  DEFAULT_GEMINI_BULK_MODEL,
  DEFAULT_GEMINI_MODEL,
} from "./gemini";
import { createLocalProvider } from "./local";
import { createOpenAiProvider } from "./openai";
import { meterProvider, type AuthMode } from "@/lib/usage";

import { LlmError, type LlmProvider } from "./types";

export * from "./types";
export {
  createGeminiProvider,
  DEFAULT_GEMINI_BULK_MODEL,
  DEFAULT_GEMINI_MODEL,
} from "./gemini";
export * from "./pricing";
export { createAnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "./anthropic";
export { createOpenAiProvider, DEFAULT_OPENAI_MODEL } from "./openai";
export { createLocalProvider, unloadLocalModel } from "./local";
export * from "./catalog";
export {
  startModelDownload,
  clearDownload,
  isDownloading,
  modelsRoot,
} from "./download";

/**
 * Resolves the configured provider.
 *
 * Four implementations now sit behind the interface Phase 2 defined — three
 * hosted APIs and one model running on the student's own machine — and
 * everything above this line still knows only `LlmProvider`. Nothing in
 * generation, coverage, grading, or assistance changed to add any of them.
 */
/**
 * What the model is being used for.
 *
 * "bulk" is deck generation: hundreds of cards, nobody waiting on any single
 * one, cost dominated by volume. "interactive" is everything else. Only Gemini
 * currently has a cheaper tier worth routing to; other providers answer both
 * roles with the model the student configured.
 */
export type ProviderRole = "bulk" | "interactive";

/**
 * The model a bulk run will use, without constructing a provider — so the
 * panel can show a calibrated estimate even before a key is entered.
 */
export function bulkModelName(): string | null {
  const provider = readProvider();
  if (provider !== "gemini") return null;
  return process.env.GEMINI_BULK_MODEL ?? DEFAULT_GEMINI_BULK_MODEL;
}

export function getProvider(
  override?: ProviderId,
  role: ProviderRole = "interactive",
): LlmProvider {
  const { provider, authMode } = resolveProvider(override, role);
  // Every call is offered to the usage log, which records it only if the
  // student has opted in.
  return meterProvider(provider, authMode);
}

function resolveProvider(
  override: ProviderId | undefined,
  role: ProviderRole,
): { provider: LlmProvider; authMode: AuthMode } {
  const provider = override ?? readProvider();

  switch (provider) {
    case "local": {
      const { id, path } = readLocalModel();
      const download = readDownload();

      if (!path || download?.status !== "ready") {
        throw new LlmError(
          download?.status === "downloading"
            ? "The offline model is still downloading."
            : "No offline model is installed yet. Choose one in Settings.",
        );
      }

      return {
        provider: createLocalProvider({ modelPath: path, modelName: id ?? "local" }),
        authMode: "local",
      };
    }

    case "anthropic":
      return {
        provider: createAnthropicProvider({ apiKey: readApiKey("anthropic") }),
        authMode: keySource("ANTHROPIC_API_KEY"),
      };

    case "openai":
      return {
        provider: createOpenAiProvider({ apiKey: readApiKey("openai") }),
        authMode: keySource("OPENAI_API_KEY"),
      };

    case "gemini":
    default: {
      const credentials = geminiCredentials();
      const gemini = createGeminiProvider({
        ...credentials,
        model:
          role === "bulk"
            ? (process.env.GEMINI_BULK_MODEL ?? DEFAULT_GEMINI_BULK_MODEL)
            : undefined,
        fallbackModel:
          role === "bulk"
            ? (process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL)
            : undefined,
      });
      return {
        provider: gemini,
        authMode:
          "accessToken" in credentials
            ? "google_oauth"
            : keySource("GEMINI_API_KEY"),
      };
    }
  }
}

function keySource(variable: string): AuthMode {
  return process.env[variable]?.trim() ? "env_key" : "api_key";
}

/**
 * How Gemini calls authenticate, first match wins:
 *
 *  1. GEMINI_API_KEY in the environment — a developer's .env.local overrides
 *     everything, as it does for every provider. (The Gemini SDK would send
 *     that key anyway; it reads the variable itself.)
 *  2. A "Sign in with Google" session: the student's own account, no key.
 *  3. A key saved in Settings, kept as the fallback.
 */
function geminiCredentials():
  | { apiKey: string }
  | { accessToken: () => Promise<string> }
  | { apiKey: undefined } {
  const fromEnv = process.env.GEMINI_API_KEY?.trim();
  if (fromEnv) return { apiKey: fromEnv };
  if (hasGoogleSession()) return { accessToken: sessionToken };
  return { apiKey: readApiKey("gemini") };
}

/** One stable function, so the provider reuses one OAuth client. */
const sessionToken = () => googleAccessToken();
