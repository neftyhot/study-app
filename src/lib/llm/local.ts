/**
 * Local model provider — the offline one.
 *
 * Runs a downloaded GGUF model through llama.cpp in this process. The whole
 * pipeline depends on strict JSON, and a small local model asked politely for
 * JSON will not reliably produce it, so generation is *constrained* by a
 * grammar built from the same schema the caller passes: tokens that would
 * break the shape are never sampled. That is what makes a 1.5B model usable
 * here at all.
 *
 * The model is loaded once and kept: loading a multi-gigabyte file per request
 * would cost more than the request.
 */
import type { JsonSchema } from "./types";
import { LlmError, type LlmProvider, type StructuredRequest } from "./types";

/** Context window. Generous enough for a slide batch, small enough to load. */
const CONTEXT_SIZE = 8192;

type Runtime = Awaited<ReturnType<typeof getRuntime>>;
type Loaded = Runtime & { path: string };

let loaded: Promise<Loaded> | null = null;
let loadedPath: string | null = null;

async function importLlama() {
  // Imported lazily: the native binary should not load unless a local model is
  // actually the configured provider.
  return import("node-llama-cpp");
}

async function getRuntime(modelPath: string) {
  const { getLlama, LlamaLogLevel } = await importLlama();
  const llama = await getLlama({ logLevel: LlamaLogLevel.error });
  const model = await llama.loadModel({ modelPath });
  return { llama, model };
}

async function load(modelPath: string) {
  if (loaded && loadedPath === modelPath) return loaded;

  loadedPath = modelPath;
  loaded = getRuntime(modelPath).then((runtime) => ({
    ...runtime,
    path: modelPath,
  }));

  return loaded;
}

/** Frees the loaded model, for when the student switches provider or model. */
export async function unloadLocalModel() {
  const current = loaded;
  loaded = null;
  loadedPath = null;

  try {
    const resolved = await current;
    await resolved?.model.dispose();
  } catch {
    // Nothing useful to do if it was never loaded.
  }
}

/**
 * Strips the parts of a JSON Schema the grammar builder does not model.
 *
 * `description` and `additionalProperties` carry no constraint that a grammar
 * can enforce, and passing them through makes the builder reject the schema.
 * Everything that shapes the output — types, properties, required, enums,
 * array items — is preserved exactly.
 */
export function toGrammarSchema(schema: JsonSchema): JsonSchema {
  if (Array.isArray(schema)) {
    return schema.map((item) => toGrammarSchema(item as JsonSchema)) as never;
  }
  if (!schema || typeof schema !== "object") return schema;

  const copy: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === "description" || key === "additionalProperties") continue;
    copy[key] =
      value && typeof value === "object"
        ? toGrammarSchema(value as JsonSchema)
        : value;
  }

  return copy;
}

export function createLocalProvider(options: {
  modelPath: string;
  modelName?: string;
}): LlmProvider {
  return {
    name: "local",
    model: options.modelName ?? "local model",

    async generateStructured<T>(request: StructuredRequest) {
      try {
        const { llama, model } = await load(options.modelPath);
        const { LlamaChatSession, LlamaJsonSchemaGrammar } = await importLlama();

        const grammar = new LlamaJsonSchemaGrammar(
          llama,
          toGrammarSchema(request.schema) as never,
        );

        const context = await model.createContext({
          contextSize: Math.min(CONTEXT_SIZE, model.trainContextSize),
        });

        try {
          const session = new LlamaChatSession({
            contextSequence: context.getSequence(),
            systemPrompt: request.system,
          });

          const answer = await session.prompt(request.prompt, {
            grammar,
            temperature: request.temperature ?? 0,
            maxTokens: request.maxOutputTokens,
          });

          return { data: grammar.parse(answer) as T };
        } finally {
          // The context holds the KV cache; releasing it between requests
          // keeps memory flat across a long generation run.
          await context.dispose();
        }
      } catch (error) {
        throw new LlmError(
          error instanceof Error
            ? `Local model failed: ${error.message}`
            : String(error),
          error,
        );
      }
    },
  };
}
