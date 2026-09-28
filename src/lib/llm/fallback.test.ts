import { describe, expect, it } from "vitest";

import { classifyFailure, providerChain } from "./fallback";
import { LlmError, type LlmProvider } from "./types";

function fake(model: string, behaviour: () => unknown): LlmProvider & { calls: number } {
  const provider = {
    name: "gemini",
    model,
    vision: true,
    calls: 0,
    async generateStructured<T>() {
      provider.calls += 1;
      const outcome = behaviour();
      if (outcome instanceof Error) throw outcome;
      return { data: outcome as T };
    },
  };
  return provider as unknown as LlmProvider & { calls: number };
}

const noWait = { sleep: async () => {} };
const request = { feature: "test", system: "", prompt: "", schema: {} } as never;

describe("classifyFailure", () => {
  it("sorts provider errors", () => {
    expect(classifyFailure(new Error("429 RESOURCE_EXHAUSTED quota limit: 0"))).toBe("unavailable");
    expect(classifyFailure(new Error("404 models/gemini-9 is not found for model"))).toBe("unavailable");
    expect(classifyFailure(new Error("Your credit balance is too low"))).toBe("limit");
    expect(classifyFailure(new Error("429 insufficient_quota"))).toBe("limit");
    expect(classifyFailure(new Error("429 Rate limit reached"))).toBe("rate");
    expect(classifyFailure(new Error("503 overloaded"))).toBe("busy");
    expect(classifyFailure(new Error("401 invalid api key"))).toBeNull();
  });
});

describe("providerChain", () => {
  it("falls to the next model and reports which answered", async () => {
    const pro = fake("pro", () => new Error("429 limit: 0"));
    const flash = fake("flash", () => ({ ok: true }));
    const chain = providerChain([pro, flash], noWait);
    expect((await chain.generateStructured(request)).data).toEqual({ ok: true });
    expect(chain.model).toBe("flash");
    await chain.generateStructured(request);
    expect(pro.calls).toBe(1); // Closed after it proved unavailable.
  });

  it("throws a bad key at once", async () => {
    const first = fake("a", () => new Error("401 invalid api key"));
    const second = fake("b", () => ({}));
    await expect(providerChain([first, second], noWait).generateStructured(request)).rejects.toThrow("401");
    expect(second.calls).toBe(0);
  });

  it("names the upgrade when every model is out of quota", async () => {
    const chain = providerChain(
      [fake("a", () => new Error("429 quota")), fake("b", () => new Error("insufficient_quota"))],
      noWait,
    );
    const error = await chain.generateStructured(request).catch((e) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.kind).toBe("limit");
    expect(error.message).toMatch(/Upgrade/);
  });

  it("keeps the chosen model for bulk rate limits", async () => {
    const first = fake("a", () => new Error("429 Rate limit reached"));
    const second = fake("b", () => ({}));
    await expect(
      providerChain([first, second], { ...noWait, fallBackOnRate: false }).generateStructured(request),
    ).rejects.toThrow("Rate limit");
    expect(second.calls).toBe(0);
  });

  it("retries a busy server once before moving on", async () => {
    let n = 0;
    const first = fake("a", () => (n++ === 0 ? new Error("503 UNAVAILABLE") : { fine: 1 }));
    const chain = providerChain([first, fake("b", () => ({}))], noWait);
    expect((await chain.generateStructured(request)).data).toEqual({ fine: 1 });
  });
});
