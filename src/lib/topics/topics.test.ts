import { describe, expect, it } from "vitest";

import { needsRegroup, renameMap, variantRenames } from "./index";

describe("renameMap", () => {
  const topics = ["Olfactory bulb", "Olfactory receptors", "Taste buds", "Gustatory pathway", "Smell"];

  it("maps each narrow topic to its broad group", () => {
    const map = renameMap(topics, [
      { name: "Olfactory system", members: ["Olfactory bulb", "olfactory  receptors", "Smell"] },
      { name: "Taste", members: ["Taste buds", "Gustatory pathway"] },
    ]);

    expect(map.get("Olfactory bulb")).toBe("Olfactory system");
    // Forgiving about the model retyping case and spacing.
    expect(map.get("Olfactory receptors")).toBe("Olfactory system");
    expect(map.get("Gustatory pathway")).toBe("Taste");
  });

  it("leaves alone anything the grouping forgot or invented", () => {
    const map = renameMap(topics, [
      { name: "Olfactory system", members: ["Olfactory bulb", "Not a real topic"] },
    ]);

    expect(map.has("Taste buds")).toBe(false);
    expect(map.has("Not a real topic")).toBe(false);
    expect(map.size).toBe(1);
  });

  it("keeps a topic in its first group if the model lists it twice", () => {
    const map = renameMap(topics, [
      { name: "Senses", members: ["Smell"] },
      { name: "Olfactory system", members: ["Smell"] },
    ]);
    expect(map.get("Smell")).toBe("Senses");
  });

  it("does not rename a topic to itself", () => {
    const map = renameMap(["Taste"], [{ name: "Taste", members: ["Taste"] }]);
    expect(map.size).toBe(0);
  });
});

describe("variantRenames", () => {
  it("folds case and spacing variants into the most-used spelling", () => {
    const renames = variantRenames([
      { topic: "Email communication", cards: 23 },
      { topic: "Email Communication", cards: 41 },
      { topic: "Email  communication.", cards: 2 },
      { topic: "Business memos", cards: 8 },
    ]);
    expect(Object.fromEntries(renames)).toEqual({
      "Email communication": "Email Communication",
      "Email  communication.": "Email Communication",
    });
  });

  it("leaves distinct topics alone", () => {
    expect(variantRenames([{ topic: "A", cards: 1 }, { topic: "B", cards: 1 }]).size).toBe(0);
  });
});

describe("needsRegroup", () => {
  const t = (cards: number, topic = `T${cards}-${Math.random()}`) => ({ topic, cards, example: "" });

  it("regroups a file with a one- or two-card topic", () => {
    expect(needsRegroup([t(12), t(19), t(1), t(7)])).toBe(true);
  });

  it("leaves a few broad topics alone", () => {
    expect(needsRegroup([t(46), t(8), t(23)])).toBe(false);
  });

  it("regroups too many topics, and anything when forced", () => {
    expect(needsRegroup(Array.from({ length: 9 }, () => t(5)))).toBe(true);
    expect(needsRegroup([t(10), t(10)], true)).toBe(true);
    expect(needsRegroup([t(1)], true)).toBe(false);
  });
});
