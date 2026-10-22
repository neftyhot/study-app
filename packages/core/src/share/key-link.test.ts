import { describe, expect, it } from "vitest";

import { buildKeyLink, isKeyLink, KEY_LINK_LIFETIME_MS, parseKeyLink } from "./key-link";

// Made up for the test; shaped like a Gemini key.
const KEY = "AIzaTEST-not-a-real-key_0123456789abc";
const NOW = Date.UTC(2026, 9, 22, 12);

describe("sending the AI key to a phone", () => {
  it("round-trips a key through the link", () => {
    const link = buildKeyLink(`  ${KEY} `, NOW);
    expect(link.startsWith("meganstudy://ai-key?")).toBe(true);
    expect(isKeyLink(link)).toBe(true);
    expect(parseKeyLink(link, NOW + 1000)).toEqual({ ok: true, provider: "gemini", key: KEY });
  });

  it("stops working once the code has been up too long, with room for clock drift", () => {
    const link = buildKeyLink(KEY, NOW);
    expect(parseKeyLink(link, NOW + KEY_LINK_LIFETIME_MS + 60_000).ok).toBe(true);
    expect(parseKeyLink(link, NOW + KEY_LINK_LIFETIME_MS + 6 * 60_000)).toEqual({ ok: false, reason: "expired" });
  });

  it("turns away anything that isn't a key link", () => {
    expect(isKeyLink("file:///deck.meganstudy")).toBe(false);
    expect(parseKeyLink("https://example.com", NOW)).toEqual({ ok: false, reason: "invalid" });
    expect(parseKeyLink("meganstudy://ai-key", NOW)).toEqual({ ok: false, reason: "invalid" });
    expect(parseKeyLink(`meganstudy://ai-key?v=1&provider=gemini&key=short&until=${NOW}`, NOW)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(parseKeyLink(`meganstudy://ai-key?v=2&provider=gemini&key=${KEY}&until=${NOW}`, NOW)).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(parseKeyLink(`meganstudy://ai-key?v=1&provider=openai&key=${KEY}&until=${NOW}`, NOW)).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });
});
