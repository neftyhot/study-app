import { MISSING_SCOPE_MESSAGE } from "@/main/auth/googleOAuth";
import {
  GoogleGenAI,
  ThinkingLevel,
  type GoogleGenAIOptions,
  type ThinkingConfig,
} from "@google/genai";

import {
  LlmError,
  type ChatRequest,
  type LlmProvider,
  type StructuredRequest,
  type StructuredResult,
  type ThinkingEffort,
} from "./types";

/**
 * The model everything on Gemini runs on: the tutor, grading, diagrams and
 * bulk card generation alike.
 *
 * Every Flash model is free on the Gemini free tier, and one student studying
 * one deck stays well inside its daily limits, so there is nothing to save by
 * sending the bulk work to Flash-Lite. A key billed per token pays more for
 * this (see pricing.ts); GEMINI_MODEL and GEMINI_BULK_MODEL override it, and
 * the developer's server can name another without a release (models.ts).
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

/** Bulk card generation: the same Flash model, not Flash-Lite. */
export const DEFAULT_GEMINI_BULK_MODEL = DEFAULT_GEMINI_MODEL;

/**
 * Where a request goes when the chosen model is closed to this key: gone for
 * new users (404), or given no free-tier quota at all ("limit: 0"). 2.5 Flash
 * is now closed to new keys; 3.5 Flash is on every key's free tier.
 */
export const GEMINI_FALLBACK_MODEL = "gemini-3.5-flash";

export function createGeminiProvider(options?: {
  apiKey?: string;
  /**
   * Signs requests as a Google account instead of with a key: each call
   * carries `Authorization: Bearer <token>` and no key at all. Called per
   * request, so a token that lapses during a long run is replaced.
   */
  accessToken?: () => Promise<string>;
  model?: string;
  /**
   * Used instead when `model` turns out not to exist for this key. Google
   * retires models on its own schedule, and a retired bulk model should make
   * generation dearer, not impossible.
   */
  fallbackModel?: string;
}): LlmProvider {
  const accessToken = options?.accessToken;
  const apiKey = options?.apiKey ?? process.env.GEMINI_API_KEY;
  if (!accessToken && !apiKey) {
    throw new LlmError(
      "No Gemini API key. Sign in with Google or add a key in Settings, or set GEMINI_API_KEY in .env.local.",
    );
  }

  let model =
    options?.model ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const client = accessToken
    ? oauthClient(accessToken)
    : new GoogleGenAI({ apiKey });

  /** Runs a request, moving to the fallback model once if this one is gone. */
  async function call<R>(request: (model: string) => Promise<R>): Promise<R> {
    // The model this attempt used, not whatever `model` is by the time it
    // fails: twenty batches in flight all hit the 404 together, and each one
    // must retry even though the first has already switched.
    const attempted = model;
    try {
      return await request(attempted);
    } catch (error) {
      // A thinking level this model refuses: remember it and ask again on
      // the same model, which then gets the nearest level it does accept.
      if (noteRefusedThinking(attempted, error)) return call(request);

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

const oauthClients = new WeakMap<() => Promise<string>, GoogleGenAI>();

/**
 * A client that authenticates with an OAuth access token.
 *
 * With no key, the SDK asks `googleAuthOptions.authClient` for request
 * headers before every call; this one answers with a bearer token fetched
 * at that moment. It is the SDK's own hook, so every endpoint it reaches —
 * generateContent, uploads, model listing — is signed the same way.
 *
 * One client per token source, because constructing one without a key logs
 * "API key should be set" each time, and providers are built per request.
 */
function oauthClient(accessToken: () => Promise<string>): GoogleGenAI {
  let client = oauthClients.get(accessToken);
  if (!client) {
    const authClient = {
      async getRequestHeaders() {
        return new Headers({ Authorization: `Bearer ${await accessToken()}` });
      },
    };
    client = new GoogleGenAI({
      googleAuthOptions: {
        // Only `getRequestHeaders` is ever called on it; the full AuthClient
        // type would mean depending on google-auth-library to build one.
        authClient,
      } as unknown as GoogleGenAIOptions["googleAuthOptions"],
    });
    oauthClients.set(accessToken, client);
  }
  return client;
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

  const level = acceptedLevel(model, thinking);
  return level ? { thinkingConfig: { thinkingLevel: level } } : {};
}

const LEVELS = [
  ThinkingLevel.MINIMAL,
  ThinkingLevel.LOW,
  ThinkingLevel.MEDIUM,
  ThinkingLevel.HIGH,
] as const;

/** Levels a model has turned down this session, learned from its 400s. */
const refusedLevels = new Map<string, Set<string>>();

/**
 * The asked-for level, or the next one up that this model accepts. Pro
 * models have no MINIMAL (they always think a little), so asking one for
 * minimal gets low. Undefined leaves the model on its own default.
 */
function acceptedLevel(
  model: string,
  thinking: Exclude<ThinkingEffort, "default">,
): ThinkingLevel | undefined {
  const refused = new Set(refusedLevels.get(model));
  if (/-pro\b/.test(model)) refused.add(ThinkingLevel.MINIMAL);
  const start = { minimal: 0, low: 1, medium: 2, high: 3 }[thinking];
  return LEVELS.slice(start).find((level) => !refused.has(level));
}

/**
 * Records a "Thinking level X is not supported for this model" refusal.
 * True when the request is worth sending again with a different level.
 */
export function noteRefusedThinking(model: string, error: unknown): boolean {
  const match = /Thinking level (\w+) is not supported/i.exec(describe(error));
  if (!match) return false;
  const level = match[1].toUpperCase();
  const refused = refusedLevels.get(model) ?? new Set<string>();
  if (refused.has(level)) return false;
  refused.add(level);
  refusedLevels.set(model, refused);
  console.warn(`[gemini] ${model} refuses thinking level ${level}; trying another.`);
  return true;
}

/**
 * The model itself is closed to this key, as opposed to any other failed
 * request: a 404 for the model, or a quota of zero (a model the free tier
 * does not cover). An ordinary 429, a quota that is merely used up, is not.
 */
export function isModelUnavailable(error: unknown): boolean {
  const text = describe(error);
  if (/"code":\s*404|NOT_FOUND/.test(text) && /model/i.test(text)) return true;
  return /"code":\s*429|RESOURCE_EXHAUSTED/.test(text) && /limit:\s*0\b/.test(text);
}

function describe(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  // A Google sign-in whose Gemini permission was unticked on the consent
  // screen: the raw 403 means nothing to a student, and the fix is theirs.
  if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(message)) {
    return MISSING_SCOPE_MESSAGE.replace("Sign in again", "In Settings, sign out of Google and sign in again");
  }
  return message;
}
