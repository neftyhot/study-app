import { GoogleGenAI } from "@google/genai";

import {
  LlmError,
  type LlmProvider,
  type StructuredRequest,
  type StructuredResult,
} from "./types";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export function createGeminiProvider(options?: {
  apiKey?: string;
  model?: string;
}): LlmProvider {
  const apiKey = options?.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new LlmError(
      "No Gemini API key. Add one in Settings, or set GEMINI_API_KEY in .env.local.",
    );
  }

  const model = options?.model ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const client = new GoogleGenAI({ apiKey });

  return {
    name: "gemini",
    model,

    async generateStructured<T>(
      request: StructuredRequest,
    ): Promise<StructuredResult<T>> {
      let response;
      try {
        response = await client.models.generateContent({
          model,
          contents: request.prompt,
          config: {
            systemInstruction: request.system,
            // `responseJsonSchema` takes standard JSON Schema; the older
            // `responseSchema` field expects the OpenAPI subset instead.
            responseMimeType: "application/json",
            responseJsonSchema: request.schema,
            temperature: request.temperature ?? 0,
            maxOutputTokens: request.maxOutputTokens,
          },
        });
      } catch (error) {
        throw new LlmError(`Gemini request failed: ${describe(error)}`, error);
      }

      const text = response.text;
      if (!text) {
        throw new LlmError(
          `Gemini returned no content (finishReason: ${
            response.candidates?.[0]?.finishReason ?? "unknown"
          }).`,
        );
      }

      let data: T;
      try {
        data = JSON.parse(text) as T;
      } catch (error) {
        // Structured output should make this unreachable; if it happens the
        // response is genuinely unusable, so fail loudly rather than salvage.
        throw new LlmError(
          `Gemini returned malformed JSON despite a response schema: ${describe(error)}`,
          error,
        );
      }

      return {
        data,
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount,
          outputTokens: response.usageMetadata?.candidatesTokenCount,
        },
      };
    },
  };
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
