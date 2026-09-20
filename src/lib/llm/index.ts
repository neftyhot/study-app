import { resolveGeminiKey } from "@/lib/settings";

import { createGeminiProvider } from "./gemini";
import type { LlmProvider } from "./types";

export * from "./types";
export { createGeminiProvider, DEFAULT_GEMINI_MODEL } from "./gemini";

/**
 * Resolves the configured provider. Gemini is the only implementation today;
 * an Anthropic one would slot in here without touching any caller.
 *
 * The key comes from the environment when there is one and from local settings
 * otherwise, so a packaged desktop app — which has no environment to speak of
 * — works the same way a development checkout does.
 */
export function getProvider(): LlmProvider {
  return createGeminiProvider({ apiKey: resolveGeminiKey() });
}
