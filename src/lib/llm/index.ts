import { createGeminiProvider } from "./gemini";
import type { LlmProvider } from "./types";

export * from "./types";
export { createGeminiProvider, DEFAULT_GEMINI_MODEL } from "./gemini";

/**
 * Resolves the configured provider. Gemini is the only implementation today;
 * an Anthropic one would slot in here without touching any caller.
 */
export function getProvider(): LlmProvider {
  return createGeminiProvider();
}
