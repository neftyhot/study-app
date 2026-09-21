import { describe, expect, it } from "vitest";

import { buildMcq, stripQuestionEcho } from "./mcq";

describe("stripQuestionEcho", () => {
  it.each([
    ["What is the primary hormone synthesized by the pineal gland?", "The pineal gland synthesizes melatonin.", "Melatonin."],
    ["What cells in the adrenal medulla release catecholamines?", "Chromaffin cells release catecholamines.", "Chromaffin cells"],
    ["Which cells in the testes produce testosterone?", "Leydig cells (interstitial cells).", "Leydig cells (interstitial cells)."],
    ["What must hydrophobic hormones bind to?", "Transport proteins.", "Transport proteins."],
  ])("%s", (question, option, expected) => {
    expect(stripQuestionEcho(option, question)).toBe(expected);
  });

  it("never reduces an option to nothing", () => {
    expect(stripQuestionEcho("ADH", "What does ADH stand for?")).toBe("ADH");
  });
});

describe("buildMcq", () => {
  it("does not let the right answer stand out by repeating the question", () => {
    const card = {
      id: "c1",
      topic: "Pineal",
      question: "What hormone does the pineal gland synthesize?",
      directAnswer: "The pineal gland synthesizes melatonin.",
      misconceptions: ["Serotonin"],
    };
    const deck = [
      card,
      { id: "c2", topic: "Pineal", question: "Q2", directAnswer: "Oxytocin", misconceptions: [] },
      { id: "c3", topic: "Pineal", question: "Q3", directAnswer: "Cortisol", misconceptions: [] },
    ];

    const options = buildMcq(card, deck, { seed: 1 });
    const correct = options.find((option) => option.correct)!;
    expect(correct.text).toBe("Melatonin.");
    for (const option of options) {
      expect(option.text.toLowerCase()).not.toContain("pineal");
    }
  });
});
