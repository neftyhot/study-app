import { afterEach, describe, expect, it } from "vitest";

import { BUILT_IN_MODELS, modelFor, sanitizeModels } from "./models";

describe("sanitizeModels", () => {
  it("keeps known slots with plain names", () => {
    expect(
      sanitizeModels({ gemini: "gemini-3-flash", anthropic: "claude-sonnet-5", other: "x" }),
    ).toEqual({ gemini: "gemini-3-flash", anthropic: "claude-sonnet-5" });
  });

  it("drops anything that is not a model name", () => {
    expect(sanitizeModels({ gemini: "", openai: "a b", anthropic: 7 })).toEqual({});
    expect(sanitizeModels(null)).toEqual({});
    expect(sanitizeModels("gemini")).toEqual({});
  });
});

describe("modelFor", () => {
  const saved = process.env.GEMINI_MODEL;
  afterEach(() => {
    if (saved === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = saved;
  });

  it("prefers the environment", () => {
    process.env.GEMINI_MODEL = "from-env";
    expect(modelFor("gemini")).toBe("from-env");
  });

  it("falls back to the built-in name", () => {
    delete process.env.GEMINI_MODEL;
    expect(modelFor("geminiPrimer")).toBe(
      process.env.GEMINI_PRIMER_MODEL || BUILT_IN_MODELS.geminiPrimer,
    );
  });
});
