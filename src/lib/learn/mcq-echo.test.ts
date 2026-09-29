import { describe, expect, it } from "vitest";

import { buildMcq, familyVariants, isFragment, stripQuestionEcho } from "./mcq";

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

describe("fragments and families", () => {
  it.each([
    ["III", true],
    ["II.", true],
    ["β", true],
    ["Beta", true],
    ["Melatonin.", false],
    ["ADH", false],
    ["Beta cells", false],
  ])("isFragment(%s) is %s", (text, expected) => {
    expect(isFragment(text)).toBe(expected);
  });

  it("offers the other members of a numbered family", () => {
    expect(familyVariants("DNA polymerase III")).toEqual([
      "DNA polymerase II",
      "DNA polymerase IV",
      "DNA polymerase I",
      "DNA polymerase V",
    ]);
    expect(familyVariants("Beta cells")).toEqual([
      "Alpha cells",
      "Gamma cells",
      "Delta cells",
      "Epsilon cells",
    ]);
    expect(familyVariants("Vitamin D")).toContain("Vitamin C");
    expect(familyVariants("Melatonin")).toEqual([]);
    expect(familyVariants("I think so")).toEqual([]);
  });

  it("keeps a numbered answer whole and pits it against its siblings", () => {
    const card = {
      id: "c1",
      topic: "Replication",
      question: "What is the DNA polymerase that replaces RNA with DNA?",
      directAnswer: "DNA polymerase I",
      misconceptions: [],
    };
    const deck = [
      card,
      { id: "c2", topic: "Replication", question: "Q2", directAnswer: "Primase", misconceptions: [] },
      { id: "c3", topic: "Replication", question: "Q3", directAnswer: "Helicase", misconceptions: [] },
      { id: "c4", topic: "Replication", question: "Q4", directAnswer: "DNA polymerase III", misconceptions: [] },
    ];

    for (let seed = 0; seed < 20; seed += 1) {
      const options = buildMcq(card, deck, { seed });
      const texts = options.map((option) => option.text);
      expect(options.find((option) => option.correct)!.text).toBe("DNA polymerase I");
      expect(texts).toContain("DNA polymerase II");
      expect(texts).toContain("DNA polymerase III");
      for (const text of texts) expect(isFragment(text)).toBe(false);
      expect(new Set(texts).size).toBe(texts.length);
    }
  });

  it("keeps a distractor whole when trimming would leave a numeral", () => {
    const card = {
      id: "c1",
      topic: "Replication",
      question: "Which enzyme lays down the RNA primer for DNA polymerase?",
      directAnswer: "Primase",
      misconceptions: ["DNA polymerase III"],
    };
    const options = buildMcq(card, [card], { seed: 3 });
    expect(options.map((option) => option.text)).toContain("DNA polymerase III");
  });
});
