/**
 * Provider selection, the model catalog, and the two schema dialects.
 *
 * Four implementations now sit behind one interface. What matters is that the
 * schema each caller writes survives the trip to whichever one is configured.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { GENERATED_CARD_SCHEMA } from "@/lib/generate/schemas";
import {
  formatBytes,
  findModel,
  LOCAL_MODELS,
  recommendedModel,
} from "./catalog";
import { createGeminiProvider } from "./gemini";
import { toGrammarSchema } from "./local";
import { toStrictSchema } from "./openai";
import { saveSession } from "@/main/auth/tokenStore";
import {
  apiKeyStatus,
  isAnswerable,
  readApiKey,
  readProvider,
  writeApiKey,
  writeDownload,
  writeProvider,
} from "@/lib/settings";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;

beforeEach(() => {
  const sqlite = new Database(":memory:");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
});

describe("model catalog", () => {
  it("offers a range from try-it-out to genuinely capable", () => {
    expect(LOCAL_MODELS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(LOCAL_MODELS.map((m) => m.tier))).toContain("minimal");
    expect(new Set(LOCAL_MODELS.map((m) => m.tier))).toContain("strong");
  });

  it("is ordered smallest to largest", () => {
    const sizes = LOCAL_MODELS.map((model) => model.bytes);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
  });

  it("tells the student what each one cannot do", () => {
    // The small models are the ones people pick by accident, so the honest
    // warning is required rather than optional on those tiers.
    for (const model of LOCAL_MODELS.filter((m) => m.tier !== "capable")) {
      if (model.tier === "strong") continue;
      expect(model.caution, model.id).toBeTruthy();
    }
  });

  it("gives every model a license, a size, and a memory requirement", () => {
    for (const model of LOCAL_MODELS) {
      expect(model.license, model.id).toBeTruthy();
      expect(model.bytes, model.id).toBeGreaterThan(0);
      expect(model.minimumRamGb, model.id).toBeGreaterThan(0);
      expect(model.uri, model.id).toMatch(/^https:\/\/huggingface\.co\//);
      expect(model.uri.endsWith(".gguf"), model.id).toBe(true);
    }
  });

  it("recommends something that will actually fit in memory", () => {
    for (const ram of [4, 8, 16, 32, 64]) {
      const model = recommendedModel(ram);
      expect(model.minimumRamGb, `${ram}GB`).toBeLessThanOrEqual(ram);
    }
  });

  it("never recommends the model it says cannot do the work", () => {
    expect(recommendedModel(64).tier).not.toBe("minimal");
    expect(recommendedModel(8).tier).not.toBe("minimal");
  });

  it("falls back to the smallest model on a tiny machine", () => {
    expect(recommendedModel(1).id).toBe(LOCAL_MODELS[0].id);
  });

  it("formats sizes the way a download dialog should", () => {
    expect(formatBytes(386_000_000)).toBe("386 MB");
    expect(formatBytes(4_683_000_000)).toBe("4.7 GB");
  });

  it("looks a model up by id", () => {
    expect(findModel("qwen2.5-7b")?.name).toBe("Qwen2.5 7B");
    expect(findModel("nope")).toBeUndefined();
  });
});

describe("local grammar schema", () => {
  it("drops what a grammar cannot enforce and keeps what it can", () => {
    const grammar = toGrammarSchema(GENERATED_CARD_SCHEMA) as Record<
      string,
      never
    >;
    const json = JSON.stringify(grammar);

    expect(json).not.toContain("description");
    expect(json).not.toContain("additionalProperties");
    // The shape itself must survive intact.
    expect(json).toContain("sourceExcerpt");
    expect(json).toContain("required");
    expect(json).toContain("enum");
  });

  it("keeps enum values exactly", () => {
    const grammar = toGrammarSchema({
      type: "object",
      properties: { verdict: { type: "string", enum: ["a", "b"] } },
      required: ["verdict"],
      additionalProperties: false,
    }) as { properties: { verdict: { enum: string[] } } };

    expect(grammar.properties.verdict.enum).toEqual(["a", "b"]);
  });
});

describe("openai strict schema", () => {
  it("requires every property, making optional ones nullable instead", () => {
    const strict = toStrictSchema({
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "string" },
      },
      required: ["a"],
    }) as {
      required: string[];
      additionalProperties: boolean;
      properties: { a: { type: unknown }; b: { type: unknown } };
    };

    // Strict mode rejects a schema with unlisted properties, so an optional
    // field becomes a nullable required one rather than disappearing.
    expect(strict.required).toEqual(["a", "b"]);
    expect(strict.additionalProperties).toBe(false);
    expect(strict.properties.a.type).toBe("string");
    expect(strict.properties.b.type).toEqual(["string", "null"]);
  });

  it("walks into arrays and nested objects", () => {
    const strict = toStrictSchema(GENERATED_CARD_SCHEMA) as {
      properties: {
        cards: { items: { required: string[]; additionalProperties: boolean } };
      };
    };

    const card = strict.properties.cards.items;
    expect(card.additionalProperties).toBe(false);
    expect(card.required).toContain("optionalPoints");
    expect(card.required).toContain("sourceExcerpt");
  });
});

describe("provider selection", () => {
  const saved = {
    gemini: process.env.GEMINI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  };

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      const key = `${name.toUpperCase()}_API_KEY`;
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("defaults to Gemini when nothing has been chosen", () => {
    expect(readProvider(db)).toBe("gemini");
  });

  it("stores a key per provider and keeps them apart", () => {
    writeApiKey("anthropic", "sk-ant-aaaa", db);
    writeApiKey("openai", "sk-openai-bbbb", db);

    expect(readApiKey("anthropic", db)).toBe("sk-ant-aaaa");
    expect(readApiKey("openai", db)).toBe("sk-openai-bbbb");
    expect(readApiKey("gemini", db)).toBeUndefined();
  });

  it("lets the environment override a saved key", () => {
    writeApiKey("anthropic", "saved-key", db);
    process.env.ANTHROPIC_API_KEY = "env-key";

    expect(readApiKey("anthropic", db)).toBe("env-key");
    expect(apiKeyStatus("anthropic", db).fromEnvironment).toBe(true);
  });

  it("never exposes more than the last four characters", () => {
    writeApiKey("gemini", "AIzaSy-super-secret-1234", db);
    const status = apiKeyStatus("gemini", db);

    expect(status.hint).toBe("1234");
    expect(JSON.stringify(status)).not.toContain("super-secret");
  });

  it("knows whether it can answer at all", () => {
    writeProvider("anthropic", db);
    expect(isAnswerable(db)).toBe(false);

    writeApiKey("anthropic", "sk-ant-xyz", db);
    expect(isAnswerable(db)).toBe(true);
  });

  it("treats a local model as unusable until the download finishes", () => {
    writeProvider("local", db);
    expect(isAnswerable(db)).toBe(false);

    writeDownload(
      {
        modelId: "qwen2.5-7b",
        status: "downloading",
        downloadedBytes: 1,
        totalBytes: 2,
      },
      db,
    );
    expect(isAnswerable(db)).toBe(false);

    writeDownload(
      {
        modelId: "qwen2.5-7b",
        status: "ready",
        downloadedBytes: 2,
        totalBytes: 2,
        path: "/models/qwen.gguf",
      },
      db,
    );
    expect(isAnswerable(db)).toBe(true);
  });

  it("does not let one provider's key satisfy another", () => {
    writeProvider("openai", db);
    writeApiKey("gemini", "AIza-whatever", db);
    expect(isAnswerable(db)).toBe(false);
  });
});

describe("Gemini signed in with Google", () => {
  const envKeys = ["GEMINI_API_KEY", "GOOGLE_API_KEY"] as const;
  const saved: Partial<Record<(typeof envKeys)[number], string>> = {};

  beforeEach(() => {
    for (const name of envKeys) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const name of envKeys) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it("sends a bearer token and no API key, fetching the token per call", async () => {
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(new Request(input, init));
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    const tokens = ["token-1", "token-2"];
    const accessToken = vi.fn(async () => tokens.shift()!);

    const provider = createGeminiProvider({ accessToken });
    const request = { system: "s", prompt: "p", schema: { type: "object" } };
    await expect(provider.generateStructured(request)).resolves.toMatchObject({
      data: { ok: true },
    });
    await provider.generateStructured(request);

    expect(requests).toHaveLength(2);
    for (const [index, sent] of requests.entries()) {
      const url = new URL(sent.url);
      expect(url.origin).toBe("https://generativelanguage.googleapis.com");
      expect(url.searchParams.has("key")).toBe(false);
      expect(sent.headers.get("x-goog-api-key")).toBeNull();
      expect(sent.headers.get("authorization")).toBe(`Bearer token-${index + 1}`);
    }
  });

  it("counts as ready to answer with no key saved", () => {
    writeProvider("gemini", db);
    expect(isAnswerable(db)).toBe(false);

    saveSession(
      db.$client,
      {
        isEncryptionAvailable: () => true,
        encryptString: (text) => Buffer.from(text),
        decryptString: (buffer) => buffer.toString(),
      },
      { email: "s@gmail.com", accessToken: "a", refreshToken: "r", expiresIn: 3600 },
    );
    expect(isAnswerable(db)).toBe(true);
  });
});
