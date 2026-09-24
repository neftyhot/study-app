/**
 * The usage log: on once the privacy policy is agreed to, numbers only, and never in the way of the call.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import type { LlmProvider, StructuredRequest } from "@/lib/llm/types";

import {
  isUsageLoggingEnabled,
  meterProvider,
  recordUsage,
} from ".";
import { acceptPrivacy } from "@/lib/settings";

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
  db = drizzle(new Database(":memory:"), { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
});

const rows = () => db.select().from(schema.usageEvents).all();

function stubProvider(
  answer: () => Promise<unknown> = async () => ({
    data: { ok: true },
    usage: { inputTokens: 1_000_000, outputTokens: 100_000 },
  }),
): LlmProvider {
  return {
    name: "gemini",
    model: "gemini-2.5-flash",
    vision: true,
    generateStructured: vi.fn(answer) as LlmProvider["generateStructured"],
    generateChat: vi.fn(answer) as NonNullable<LlmProvider["generateChat"]>,
  };
}

const request: StructuredRequest = {
  feature: "grade",
  system: "SECRET SYSTEM PROMPT",
  prompt: "the student's private answer about the loop of Henle",
  schema: {},
};

describe("the privacy policy", () => {
  it("turns logging on once agreed to, with no way to opt out", () => {
    expect(isUsageLoggingEnabled(db)).toBe(false);
    acceptPrivacy(db);
    expect(isUsageLoggingEnabled(db)).toBe(true);
  });

  it("records nothing before it is agreed to", async () => {
    await meterProvider(stubProvider(), "api_key", db).generateStructured(request);
    expect(rows()).toHaveLength(0);
  });
});

describe("a metered call", () => {
  beforeEach(() => acceptPrivacy(db));

  it("records feature, model, tokens and list-price cost — and no content", async () => {
    const result = await meterProvider(stubProvider(), "api_key", db).generateStructured(
      request,
    );
    expect(result.data).toEqual({ ok: true });

    const [row] = rows();
    expect(row).toMatchObject({
      feature: "grade",
      provider: "gemini",
      model: "gemini-2.5-flash",
      authMode: "api_key",
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      success: true,
    });
    // $0.30 per million in + $2.50 per million out.
    expect(row.estimatedCostUsd).toBeCloseTo(0.3 + 0.25, 6);
    expect(row.durationMs).toBeGreaterThanOrEqual(0);

    const stored = JSON.stringify(row);
    expect(stored).not.toContain("SECRET");
    expect(stored).not.toContain("Henle");
  });

  it("logs chat calls under their own feature", async () => {
    await meterProvider(stubProvider(), "google_oauth", db).generateChat!({
      feature: "tutor",
      system: "s",
      turns: [{ role: "user", text: "hi" }],
      schema: {},
    });
    expect(rows()[0]).toMatchObject({ feature: "tutor", authMode: "google_oauth" });
  });

  it("records a failed call as failed, and still throws the original error", async () => {
    const provider = stubProvider(async () => {
      throw new Error("quota exceeded");
    });

    await expect(
      meterProvider(provider, "api_key", db).generateStructured(request),
    ).rejects.toThrow("quota exceeded");
    expect(rows()[0]).toMatchObject({ success: false, inputTokens: 0 });
  });

  it("costs a local model nothing, and an unpriced model as unknown", async () => {
    await meterProvider(stubProvider(), "local", db).generateStructured(request);

    const unpriced = { ...stubProvider(), model: "some-new-model" };
    await meterProvider(unpriced, "api_key", db).generateStructured(request);

    const [local, unknown] = rows();
    expect(local.estimatedCostUsd).toBe(0);
    expect(unknown.estimatedCostUsd).toBeNull();
  });

  it("names the model that answered, even if it changed mid-call", async () => {
    const provider = stubProvider();
    let current = "gemini-3.1-flash-lite";
    const fallingBack: LlmProvider = {
      name: "gemini",
      get model() {
        return current;
      },
      async generateStructured<T>(req: StructuredRequest) {
        current = "gemini-2.5-flash";
        return provider.generateStructured<T>(req);
      },
    };

    await meterProvider(fallingBack, "api_key", db).generateStructured(request);
    expect(rows()[0].model).toBe("gemini-2.5-flash");
  });

  it("never lets a broken log break the call", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      db.$client.exec("DROP TABLE usage_events");
      await expect(
        meterProvider(stubProvider(), "api_key", db).generateStructured(request),
      ).resolves.toMatchObject({ data: { ok: true } });
      expect(warn).toHaveBeenCalled();

      expect(() =>
        recordUsage(
          {
            feature: "grade",
            provider: "gemini",
            model: "m",
            authMode: "api_key",
            inputTokens: 1,
            outputTokens: 1,
            durationMs: 1,
            success: true,
          },
          db,
        ),
      ).not.toThrow();
    } finally {
      warn.mockRestore();
    }
  });
});
