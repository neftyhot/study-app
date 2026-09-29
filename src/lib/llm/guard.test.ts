/** The remote switches are checked on every AI call, not once per provider. */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NORMAL_STATUS, type AppStatus } from "@/lib/app-status";
import { guardProvider } from "@/lib/llm";
import { LlmError, type LlmProvider } from "@/lib/llm/types";

let current: AppStatus = NORMAL_STATUS;

vi.mock("@/lib/app-status", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/app-status")>();
  return {
    ...actual,
    readAppStatus: () => current,
    refreshAppStatus: async () => current,
  };
});

function fakeProvider() {
  const generateStructured = vi.fn(async () => ({ data: { ok: true } }) as never);
  const generateChat = vi.fn(async () => ({ data: { ok: true } }) as never);
  const provider = { name: "fake", model: "m", vision: false, generateStructured, generateChat } as unknown as LlmProvider;
  return { provider, generateStructured, generateChat };
}

const request = { system: "", prompt: "", schema: {} };

describe("guardProvider", () => {
  beforeEach(() => {
    current = NORMAL_STATUS;
  });

  it("passes calls through when nothing is switched off", async () => {
    const { provider, generateStructured } = fakeProvider();
    await guardProvider(provider).generateStructured({ ...request, feature: "generate" });
    expect(generateStructured).toHaveBeenCalledOnce();
  });

  it("refuses every call while AI is paused, without reaching the provider", async () => {
    const { provider, generateStructured, generateChat } = fakeProvider();
    const guarded = guardProvider(provider);
    current = { ...NORMAL_STATUS, mode: "ai_paused", message: "Paused for billing." };
    await expect(guarded.generateStructured({ ...request, feature: "generate" })).rejects.toThrow(LlmError);
    await expect(guarded.generateChat!({ feature: "tutor" } as never)).rejects.toThrow("Paused for billing.");
    expect(generateStructured).not.toHaveBeenCalled();
    expect(generateChat).not.toHaveBeenCalled();
  });

  it("stops a run part-way when the switch is thrown between calls", async () => {
    const { provider, generateStructured } = fakeProvider();
    const guarded = guardProvider(provider);
    await guarded.generateStructured({ ...request, feature: "generate" });
    current = { ...NORMAL_STATUS, features: { decks: false } };
    await expect(guarded.generateStructured({ ...request, feature: "generate" })).rejects.toThrow(/switched off/);
    await guarded.generateStructured({ ...request, feature: "tutor" });
    expect(generateStructured).toHaveBeenCalledTimes(2);
  });
});
