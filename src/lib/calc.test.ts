import { describe, expect, it } from "vitest";

import { evaluate, extractNumbers, formatResult, numericPart } from "./calc";

describe("evaluate", () => {
  it("does arithmetic in the usual order", () => {
    expect(evaluate("2 + 3 * 4")).toBe(14);
    expect(evaluate("(2 + 3) * 4")).toBe(20);
    expect(evaluate("2 ^ 3 ^ 2")).toBe(512);
    expect(evaluate("-3 + 5")).toBe(2);
    expect(evaluate("10 / 4")).toBe(2.5);
    expect(evaluate("2(3 + 1)")).toBe(8);
  });

  it("reads percent, thousands commas and typographic symbols", () => {
    expect(evaluate("200 * 15%")).toBe(30);
    expect(evaluate("1,200 × 2")).toBe(2400);
    expect(evaluate("9 ÷ 3 − 1")).toBe(2);
  });

  it("closes brackets left open", () => {
    expect(evaluate("(1 + 2")).toBe(3);
  });

  it("refuses anything that is not arithmetic", () => {
    expect(evaluate("alert(1)")).toBeNull();
    expect(evaluate("2 +")).toBeNull();
    expect(evaluate("1 / 0")).toBeNull();
    expect(evaluate("")).toBeNull();
    expect(evaluate("constructor")).toBeNull();
  });
});

describe("formatResult", () => {
  it("hides float noise", () => {
    expect(formatResult(0.1 + 0.2)).toBe("0.3");
    expect(formatResult(42)).toBe("42");
  });
});

describe("extractNumbers", () => {
  it("labels each number with the words before it", () => {
    const found = extractNumbers(
      "A firm has fixed costs of $5,000 and a price of $25 per unit. Variable cost is 15 per unit.",
    );
    expect(found.map((n) => n.value)).toEqual(["$5,000", "$25", "15"]);
    expect(found[0].label).toBe("firm has fixed costs of");
  });
});

describe("numericPart", () => {
  it("pulls the plain number out", () => {
    expect(numericPart("$1,200")).toBe("1200");
    expect(numericPart("15%")).toBe("15%");
    expect(numericPart("none")).toBeNull();
  });
});

describe("extractNumbers units", () => {
  it("keeps a unit that follows", () => {
    expect(extractNumbers("A 12 kg box moves 30 m/s for 5 years at 4%").map((n) => n.value)).toEqual([
      "12 kg",
      "30 m/s",
      "5 years",
      "4%",
    ]);
  });
});
