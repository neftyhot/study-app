/**
 * Anthropic provider.
 *
 * Structured output comes from a single-tool definition rather than from
 * asking for JSON in prose: the schema becomes the tool's input schema, the
 * model is forced to call it, and the arguments it passes back are the
 * structured result. That is the only way to get a hard guarantee of shape
 * from this API.
 */
import Anthropic from "@anthropic-ai/sdk";

import { LlmError, type LlmProvider, type StructuredRequest } from "./types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";

const TOOL_NAME = "respond";

export function createAnthropicProvider(options?: {
  apiKey?: string;
  model?: string;
}): LlmProvider {
  const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new LlmError(
      "No Anthropic API key. Add one in Settings, or set ANTHROPIC_API_KEY.",
    );
  }

  const model =
    options?.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
  const client = new Anthropic({ apiKey });

  return {
    name: "anthropic",
    model,

    async generateStructured<T>(request: StructuredRequest) {
      try {
        const response = await client.messages.create({
          model,
          max_tokens: request.maxOutputTokens ?? 8192,
          temperature: request.temperature ?? 0,
          system: request.system,
          messages: [{ role: "user", content: request.prompt }],
          tools: [
            {
              name: TOOL_NAME,
              description: "Return the structured result.",
              input_schema: request.schema as Anthropic.Tool["input_schema"],
            },
          ],
          tool_choice: { type: "tool", name: TOOL_NAME },
        });

        const call = response.content.find(
          (block) => block.type === "tool_use" && block.name === TOOL_NAME,
        );

        if (!call || call.type !== "tool_use") {
          throw new LlmError("Anthropic returned no structured result.");
        }

        return {
          data: call.input as T,
          usage: {
            inputTokens: response.usage?.input_tokens,
            outputTokens: response.usage?.output_tokens,
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
