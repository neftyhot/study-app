import { describe, expect, it } from "vitest";

import { renameMap } from "./index";

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
