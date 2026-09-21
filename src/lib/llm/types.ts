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

/**
 * An image handed to a model.
 *
 * Base64 rather than a path or a URL: the app is offline, so there is nowhere
 * to link to, and the provider is the only thing that ever sees the bytes.
 */
export type ChatImage = {
  mimeType: string;
  /** Base64, with no `data:` prefix. */
  data: string;
};

export type ChatTurn = {
  role: "user" | "model";
  text: string;
  images?: ChatImage[];
};

/**
 * A conversation, answered under a schema like everything else.
 *
 * The tutor talks in prose, but the response is still a schema'd object with
 * the prose inside a field (ARCHITECTURE principle #2). That is not a
 * formality: it means a reply can carry follow-up suggestions and extracted
 * cards in the same round trip, and it means a malformed response is caught
 * here rather than halfway down a rendering pipeline.
 */
export type ChatRequest = {
  system: string;
  turns: ChatTurn[];
  schema: JsonSchema;
  temperature?: number;
  maxOutputTokens?: number;
};

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  /**
   * Whether this provider can be shown a picture. A text-only model must say
   * so rather than silently ignoring the diagram it was asked about.
   */
  readonly vision?: boolean;
  generateStructured<T>(request: StructuredRequest): Promise<StructuredResult<T>>;
  /** Multi-turn conversation. Absent on a provider that cannot hold one. */
  generateChat?<T>(request: ChatRequest): Promise<StructuredResult<T>>;
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
