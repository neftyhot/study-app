/**
 * OpenAI provider.
 *
 * Uses `json_schema` response format in strict mode, which constrains decoding
 * to the schema rather than merely requesting it. Strict mode is fussier than
 * our other providers: every object must list all its properties as required
 * and set `additionalProperties: false`, so the schema is adjusted here rather
 * than forcing every caller to write a second dialect.
 */
import OpenAI from "openai";

import type { JsonSchema } from "./types";
import {
  LlmError,
  type ChatRequest,
  type LlmProvider,
  type StructuredRequest,
} from "./types";

export const DEFAULT_OPENAI_MODEL = "gpt-4.1";

/**
 * Rewrites a schema for strict mode.
 *
 * Strict mode requires every property to be listed in `required`. Properties
 * our schemas treat as optional are made nullable instead, which preserves the
 * meaning: the model may return null, and the caller's existing checks already
 * treat a missing value and a null the same way.
 */
export function toStrictSchema(schema: JsonSchema): JsonSchema {
  if (!schema || typeof schema !== "object") return schema;

  const copy: Record<string, unknown> = { ...schema };

  if (copy.type === "object" && copy.properties) {
    const properties = copy.properties as Record<string, JsonSchema>;
    const rewritten: Record<string, JsonSchema> = {};
    const required = new Set((copy.required as string[]) ?? []);

    for (const [key, value] of Object.entries(properties)) {
      const child = toStrictSchema(value);
      rewritten[key] = required.has(key)
        ? child
        : nullable(child);
    }

    copy.properties = rewritten;
    copy.required = Object.keys(rewritten);
    copy.additionalProperties = false;
  }

  if (copy.type === "array" && copy.items) {
    copy.items = toStrictSchema(copy.items as JsonSchema);
  }

  return copy;
}

function nullable(schema: JsonSchema): JsonSchema {
  const type = (schema as { type?: unknown }).type;
  if (typeof type !== "string" || type === "null") return schema;
  return { ...schema, type: [type, "null"] };
}

export function createOpenAiProvider(options?: {
  apiKey?: string;
  model?: string;
}): LlmProvider {
  const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new LlmError(
      "No OpenAI API key. Add one in Settings, or set OPENAI_API_KEY.",
    );
  }

  const model = options?.model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  const client = new OpenAI({ apiKey });

  return {
    name: "openai",
    model,
    vision: true,

    async generateChat<T>(request: ChatRequest) {
      try {
        const response = await client.chat.completions.create({
          model,
          temperature: request.temperature ?? 0.4,
          max_completion_tokens: request.maxOutputTokens ?? 4096,
          messages: [
            { role: "system" as const, content: request.system },
            ...request.turns.map((turn) =>
              turn.role === "model"
                ? { role: "assistant" as const, content: turn.text }
                : {
                    role: "user" as const,
                    content: [
                      ...(turn.images ?? []).map((image) => ({
                        type: "image_url" as const,
                        image_url: {
                          url: `data:${image.mimeType};base64,${image.data}`,
                        },
                      })),
                      { type: "text" as const, text: turn.text },
                    ],
                  },
            ),
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "structured_response",
              strict: true,
              schema: toStrictSchema(request.schema) as Record<string, unknown>,
            },
          },
        });

        const content = response.choices[0]?.message?.content;
        if (!content) throw new LlmError("OpenAI returned an empty response.");

        return {
          data: JSON.parse(content) as T,
          usage: {
            inputTokens: response.usage?.prompt_tokens,
            outputTokens: response.usage?.completion_tokens,
          },
        };
      } catch (error) {
        if (error instanceof LlmError) throw error;
        throw new LlmError(
          error instanceof Error ? error.message : String(error),
          error,
        );
      }
    },

    async generateStructured<T>(request: StructuredRequest) {
      try {
        const response = await client.chat.completions.create({
          model,
          temperature: request.temperature ?? 0,
          max_completion_tokens: request.maxOutputTokens ?? 8192,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.prompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "structured_response",
              strict: true,
              schema: toStrictSchema(request.schema) as Record<string, unknown>,
            },
          },
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new LlmError("OpenAI returned an empty response.");
        }

        return {
          data: JSON.parse(content) as T,
          usage: {
            inputTokens: response.usage?.prompt_tokens,
            outputTokens: response.usage?.completion_tokens,
          },
        };
      } catch (error) {
        if (error instanceof LlmError) throw error;
        throw new LlmError(
          error instanceof Error ? error.message : String(error),
          error,
        );
      }
    },
  };
}
