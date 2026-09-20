/**
 * Provider-neutral LLM boundary.
 *
 * ARCHITECTURE.md names Anthropic Claude; the MVP runs on Gemini. Everything
 * above this file talks to `LlmProvider` only, so switching providers means
 * adding one implementation rather than editing every call site.
 *
 * Schema Uniformity (ARCHITECTURE principle #2) is enforced here: the only way
 * to call a model is with a JSON Schema, and prose responses are never returned.
 */

/** A JSON Schema document. Kept loose — providers accept differing subsets. */
export type JsonSchema = Record<string, unknown>;

export type StructuredRequest = {
  /** Persistent role/rules instruction. */
  system: string;
  /** The task and its source material. */
  prompt: string;
  /** Schema the response must satisfy. */
  schema: JsonSchema;
  /** Lower is better for extraction; providers default to 0. */
  temperature?: number;
  maxOutputTokens?: number;
};

export type StructuredResult<T> = {
  data: T;
  /** Populated when the provider reports usage; used for cost visibility. */
  usage?: { inputTokens?: number; outputTokens?: number };
};

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generateStructured<T>(request: StructuredRequest): Promise<StructuredResult<T>>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
