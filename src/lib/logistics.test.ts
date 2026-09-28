import { describe, expect, it } from "vitest";

import { fullCoveragePrompt } from "@/lib/generate/prompts";
import { SKIP_LOGISTICS_RULE, readSkipLogistics } from "@/lib/logistics";
import { primerPrompt } from "@/lib/primer";

describe("ignoring course logistics", () => {
  it("is on unless the client turns it off", () => {
    expect(readSkipLogistics(undefined)).toBe(true);
    expect(readSkipLogistics(true)).toBe(true);
    expect(readSkipLogistics(false)).toBe(false);
  });

  it("reaches the card prompt only when asked", () => {
    expect(fullCoveragePrompt([], { skipLogistics: true })).toContain(SKIP_LOGISTICS_RULE);
    expect(fullCoveragePrompt([], { skipLogistics: false })).not.toContain(SKIP_LOGISTICS_RULE);
  });

  it("reaches the study-guide prompt, and the gap pass lets logistics slides go", () => {
    const on = primerPrompt("balanced", "x", { gapFill: true, skipLogistics: true });
    expect(on).toContain(SKIP_LOGISTICS_RULE);
    expect(on).toContain("only course logistics stays out");
    expect(primerPrompt("balanced", "x")).not.toContain(SKIP_LOGISTICS_RULE);
  });
});
