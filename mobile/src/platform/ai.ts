/**
 * The one AI client on iOS: the student's own Gemini key from the Keychain,
 * the same provider code as the desktop, and the same fallback chain (a
 * second model when the first is busy, rate-limited or retired, with one
 * retry on a busy server — see `providerChain`).
 *
 * Without a key nothing here is called: Learn grades typed answers with the
 * keyword grader and the tutor and "Snap your notes" ask for a key first.
 */
import { providerChain } from "@megan/core/llm/fallback";
import {
  createGeminiProvider,
  DEFAULT_GEMINI_MODEL,
  GEMINI_FALLBACK_MODEL,
} from "@megan/core/llm/gemini";
import type { LlmProvider } from "@megan/core/llm/types";
import type { SecretStore } from "@megan/core/platform/types";

/** The same name the desktop stores its key under. */
export const GEMINI_KEY = "gemini_api_key";

export async function readApiKey(secrets: SecretStore): Promise<string | null> {
  const key = (await secrets.get(GEMINI_KEY))?.trim();
  return key ? key : null;
}

export async function createAiClient(secrets: SecretStore): Promise<LlmProvider | null> {
  const apiKey = await readApiKey(secrets);
  if (!apiKey) return null;
  return providerChain([
    createGeminiProvider({ apiKey, model: DEFAULT_GEMINI_MODEL }),
    createGeminiProvider({ apiKey, model: GEMINI_FALLBACK_MODEL }),
  ]);
}
