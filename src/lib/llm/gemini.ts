import { GoogleGenAI, ThinkingLevel, type ThinkingConfig } from "@google/genai";

import {
  LlmError,
  type ChatRequest,
  type LlmProvider,
  type StructuredRequest,
  type StructuredResult,
  type ThinkingEffort,
} from "./types";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/**
 * The model bulk card generation runs on.
 *
 * Bulk extraction is copying structure out of slides the model is shown, not
 * reasoning about them, and it is where nearly all of a deck's tokens go —
 * so it runs on the cheapest model that still honours a response schema.
 * Everything a student waits on interactively (the tutor, diagrams, a single
 * card's explanation, grading) stays on `DEFAULT_GEMINI_MODEL`.
 *
 * Why not gemini-2.5-flash-lite, which is cheaper still ($0.10/$0.40)?
 * Google closed it to API keys created after its successor shipped: it
 * answers 404 "no longer available to new users", which is what every
 * student installing the app today would get. 3.1 Flash-Lite is the cheapest
 * model a new key can call ($0.25/$1.50 per million tokens), and measured on
 * a real chapter it cost about a fifth of gemini-2.5-flash per run.
 *
 * GEMINI_BULK_MODEL overrides it, for an older key that can still reach 2.5.
 */
export const DEFAULT_GEMINI_BULK_MODEL = "gemini-3.1-flash-lite";

export function createGeminiProvider(options?: {
  apiKey?: string;
  model?: string;
  /**
   * Used instead when `model` turns out not to exist for this key. Google
   * retires models on its own schedule, and a retired bulk model should make
   * generation dearer, not impossible.
   */
  fallbackModel?: string;
}): LlmProvider {
  const apiKey = options?.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new LlmError(
      "No Gemini API key. Add one in Settings, or set GEMINI_API_KEY in .env.local.",
    );
  }

  let model =
    options?.model ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const client = new GoogleGenAI({ apiKey });

  /** Runs a request, moving to the fallback model once if this one is gone. */
  async function call<R>(request: (model: string) => Promise<R>): Promise<R> {
    // The model this attempt used, not whatever `model` is by the time it
    // fails: twenty batches in flight all hit the 404 together, and each one
    // must retry even though the first has already switched.
    const attempted = model;
    try {
      return await request(attempted);
    } catch (error) {
      const fallback = options?.fallbackModel;
      if (!fallback || fallback === attempted || !isModelUnavailable(error)) {
        throw error;
      }

      if (model !== fallback) {
        console.warn(
          `[gemini] ${attempted} is unavailable for this key; using ${fallback}.`,
        );
        model = fallback;
      }
      return request(fallback);
    }
  }

  return {
    name: "gemini",
    // A getter, so cost and logs name the model that actually answered.
    get model() {
      return model;
    },
    vision: true,

    async generateChat<T>(request: ChatRequest): Promise<StructuredResult<T>> {
      let response;
      try {
        response = await call((model) =>
          client.models.generateContent({
            model,
            contents: request.turns.map((turn) => ({
              role: turn.role,
              parts: [
                ...(turn.images ?? []).map((image) => ({
                  inlineData: { mimeType: image.mimeType, data: image.data },
                })),
                { text: turn.text },
              ],
            })),
            config: {
              systemInstruction: request.system,
              responseMimeType: "application/json",
              responseJsonSchema: request.schema,
              temperature: request.temperature ?? 0.4,
              maxOutputTokens: request.maxOutputTokens,
            },
          }),
        );
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

      try {
        return {
          data: JSON.parse(text) as T,
          usage: {
            inputTokens: response.usageMetadata?.promptTokenCount,
            outputTokens: outputTokens(response.usageMetadata),
          },
        };
      } catch (error) {
        throw new LlmError(
          `Gemini returned malformed JSON despite a response schema: ${describe(error)}`,
          error,
        );
      }
    },

    async generateStructured<T>(
      request: StructuredRequest,
    ): Promise<StructuredResult<T>> {
      let response;
      try {
        response = await call((model) =>
          client.models.generateContent({
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
              ...thinkingConfig(model, request.thinking),
            },
          }),
        );
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
          outputTokens: outputTokens(response.usageMetadata),
        },
      };
    },
  };
}

/**
 * Output tokens as billed: the answer plus any thinking the model did first.
 *
 * `candidatesTokenCount` alone leaves thinking out, and on a thinking model
 * that is most of the bill.
 */
function outputTokens(
  usage:
    { candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined,
): number | undefined {
  if (!usage) return undefined;
  return (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
}

/**
 * The thinking control, in whichever form this model accepts: Gemini 2.x
 * takes a token budget (0 turns thinking off), and from 3.x on the budget is
 * refused in favour of a level.
 */
export function thinkingConfig(
  model: string,
  thinking: ThinkingEffort | undefined,
): { thinkingConfig?: ThinkingConfig } {
  if (!thinking || thinking === "default") return {};

  if (/^gemini-2\./.test(model)) {
    const budgets = { minimal: 0, low: 1024, medium: 4096, high: 12288 };
    return { thinkingConfig: { thinkingBudget: budgets[thinking] } };
  }

  const levels = {
    minimal: ThinkingLevel.MINIMAL,
    low: ThinkingLevel.LOW,
    medium: ThinkingLevel.MEDIUM,
    high: ThinkingLevel.HIGH,
  };
  return { thinkingConfig: { thinkingLevel: levels[thinking] } };
}

/** A 404 for the model itself, as opposed to any other failed request. */
export function isModelUnavailable(error: unknown): boolean {
  const text = describe(error);
  return /"code":\s*404|NOT_FOUND/.test(text) && /model/i.test(text);
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
