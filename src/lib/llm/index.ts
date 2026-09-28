import { googleAccessToken, hasGoogleSession } from "@/lib/auth/google-session";
import {
  readApiKey,
  readDownload,
  readLocalModel,
  readModelTier,
  readProvider,
  type ApiProviderId,
  type ProviderId,
} from "@/lib/settings";

import { createAnthropicProvider } from "./anthropic";
import { providerChain } from "./fallback";
import { createGeminiProvider } from "./gemini";
import { modelFor } from "./models";
import { modelChain } from "./tiers";
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
export * from "./tiers";
export { classifyFailure, providerChain } from "./fallback";
export { DEFAULT_GEMINI_PRIMER_MODEL, modelFor, refreshRemoteModels } from "./models";
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
export type ProviderRole = "bulk" | "interactive" | "primer";


/**
 * The model a bulk run will use, without constructing a provider — so the
 * panel can show a calibrated estimate even before a key is entered.
 */
export function bulkModelName(): string | null {
  const provider = readProvider();
  if (provider !== "gemini") return null;
  return modelFor("geminiBulk");
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

    case "anthropic": {
      const apiKey = readApiKey("anthropic");
      return {
        provider: chainFor("anthropic", modelFor("anthropic"), role, (model) =>
          createAnthropicProvider({ apiKey, model }),
        ),
        authMode: keySource("ANTHROPIC_API_KEY"),
      };
    }

    case "openai": {
      const apiKey = readApiKey("openai");
      return {
        provider: chainFor("openai", modelFor("openai"), role, (model) =>
          createOpenAiProvider({ apiKey, model }),
        ),
        authMode: keySource("OPENAI_API_KEY"),
      };
    }

    case "gemini":
    default: {
      const credentials = geminiCredentials();
      const gemini = chainFor("gemini", geminiModel(role), role, (model) =>
        // The chain does the falling back, so each link is one model only.
        createGeminiProvider({ ...credentials, model }),
      );
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

function geminiModel(role: ProviderRole): string {
  switch (role) {
    case "bulk":
      return modelFor("geminiBulk");
    case "primer":
      return modelFor("geminiPrimer");
    default:
      return modelFor("gemini");
  }
}

/**
 * The student's chosen model, then that provider's cheaper models, so a
 * retired model, a plan that lacks it or a spent quota degrades the answer
 * rather than failing it. Deck generation waits out per-minute limits
 * (generate/retry.ts) instead of finishing on a weaker model.
 */
function chainFor(
  provider: ApiProviderId,
  chosen: string,
  role: ProviderRole,
  build: (model: string) => LlmProvider,
): LlmProvider {
  const models = modelChain(provider, readModelTier(provider), chosen);
  return providerChain(models.map(build), { fallBackOnRate: role !== "bulk" });
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
