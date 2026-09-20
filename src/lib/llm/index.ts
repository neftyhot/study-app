import {
  readApiKey,
  readDownload,
  readLocalModel,
  readProvider,
  type ProviderId,
} from "@/lib/settings";

import { createAnthropicProvider } from "./anthropic";
import { createGeminiProvider } from "./gemini";
import { createLocalProvider } from "./local";
import { createOpenAiProvider } from "./openai";
import { LlmError, type LlmProvider } from "./types";

export * from "./types";
export { createGeminiProvider, DEFAULT_GEMINI_MODEL } from "./gemini";
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
export function getProvider(override?: ProviderId): LlmProvider {
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

      return createLocalProvider({ modelPath: path, modelName: id ?? "local" });
    }

    case "anthropic":
      return createAnthropicProvider({ apiKey: readApiKey("anthropic") });

    case "openai":
      return createOpenAiProvider({ apiKey: readApiKey("openai") });

    case "gemini":
    default:
      return createGeminiProvider({ apiKey: readApiKey("gemini") });
  }
}
