import { describe, expect, it } from "vitest";

import { parseStudyGuide } from "./study-guide";

describe("parseStudyGuide", () => {
  it("splits numbered objectives and keeps their labels", () => {
    const parsed = parseStudyGuide(
      [
        "Study Guide",
        "1. Describe the origin of ADH.",
        "2. Explain the trigger for aldosterone release.",
        "3) List the target tissues of insulin.",
      ].join("\n"),
    );

    expect(parsed).toHaveLength(3);
    expect(parsed.map((o) => o.label)).toEqual(["1", "2", "3"]);
    expect(parsed[0].promptText).toBe("Describe the origin of ADH.");
    expect(parsed.map((o) => o.orderIndex)).toEqual([0, 1, 2]);
  });

  it("joins wrapped continuation lines into one objective", () => {
    const parsed = parseStudyGuide(
      [
        "1. Describe the full feedback loop that regulates",
        "cortisol secretion, including the hypothalamus.",
        "2. Compare ADH and aldosterone.",
      ].join("\n"),
    );

    expect(parsed).toHaveLength(2);
    expect(parsed[0].promptText).toBe(
      "Describe the full feedback loop that regulates cortisol secretion, including the hypothalamus.",
    );
  });

  it("handles bulleted guides without labels", () => {
    const parsed = parseStudyGuide(
      ["- Define osmolarity", "• Explain tonicity", "* Contrast the two"].join(
        "\n",
      ),
    );

    expect(parsed).toHaveLength(3);
    expect(parsed.every((o) => o.label === null)).toBe(true);
    expect(parsed[1].promptText).toBe("Explain tonicity");
  });

  it("skips a qualified guide title rather than parsing it as an objective", () => {
    const parsed = parseStudyGuide(
      [
        "Exam 2 Study Guide",
        "1. Describe where ADH is produced.",
        "2. Explain aldosterone triggers.",
      ].join("\n"),
    );

    expect(parsed).toHaveLength(2);
    expect(parsed[0].promptText).toBe("Describe where ADH is produced.");
  });

  it("skips bare and qualified headings of several shapes", () => {
    const parsed = parseStudyGuide(
      [
        "Week 3 Learning Objectives",
        "- Define osmolarity",
        "Review Sheet",
        "- Explain tonicity",
      ].join("\n"),
    );

    expect(parsed.map((o) => o.promptText)).toEqual([
      "Define osmolarity",
      "Explain tonicity",
    ]);
  });

  it("skips section headings", () => {
    const parsed = parseStudyGuide(
      ["Objectives:", "1. First thing", "Chapter 4", "2. Second thing"].join(
        "\n",
      ),
    );

    expect(parsed.map((o) => o.promptText)).toEqual([
      "First thing",
      "Second thing",
    ]);
  });

  it("falls back to one objective per line for unstructured guides", () => {
    const parsed = parseStudyGuide(
      ["Know the renal handling of sodium", "Know the RAAS cascade"].join("\n"),
    );

    expect(parsed).toHaveLength(2);
    expect(parsed[0].promptText).toBe("Know the renal handling of sodium");
  });

  it("returns nothing for empty input", () => {
    expect(parseStudyGuide("   \n\n  ")).toEqual([]);
  });
});
