import { describe, expect, it } from "vitest";

import { noteRefusedThinking, thinkingConfig } from "./gemini";

describe("thinkingConfig", () => {
  it("asks a Pro model for low instead of minimal", () => {
    expect(thinkingConfig("gemini-3.1-pro-preview", "minimal")).toEqual({
      thinkingConfig: { thinkingLevel: "LOW" },
    });
  });

  it("keeps minimal for Flash", () => {
    expect(thinkingConfig("gemini-3.8-flash", "minimal")).toEqual({
      thinkingConfig: { thinkingLevel: "MINIMAL" },
    });
  });

  it("moves up a level after the model refuses one, once", () => {
    const error = new Error(
      '{"error":{"code":400,"message":"Thinking level MINIMAL is not supported for this model. Please retry with other thinking level.","status":"INVALID_ARGUMENT"}}',
    );
    expect(noteRefusedThinking("gemini-test-flash", error)).toBe(true);
    expect(noteRefusedThinking("gemini-test-flash", error)).toBe(false);
    expect(thinkingConfig("gemini-test-flash", "minimal")).toEqual({
      thinkingConfig: { thinkingLevel: "LOW" },
    });
  });

  it("ignores other errors", () => {
    expect(noteRefusedThinking("gemini-x", new Error("quota"))).toBe(false);
  });
});
