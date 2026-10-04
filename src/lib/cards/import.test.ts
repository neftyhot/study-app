import { describe, expect, it } from "vitest";

import { guessSideSeparator, parseImportedCards } from "./import";

describe("parseImportedCards", () => {
  it("reads Quizlet's default export: a tab between sides, a line per card", () => {
    const result = parseImportedCards(
      "Mitral valve\tLeft AV valve\nTricuspid valve\tRight AV valve\n",
    );

    expect(result).toEqual({
      cards: [
        { front: "Mitral valve", back: "Left AV valve" },
        { front: "Tricuspid valve", back: "Right AV valve" },
      ],
      incomplete: 0,
    });
  });

  it("keeps a definition that runs over several lines on its own card", () => {
    const result = parseImportedCards(
      "Layers of the heart\tEpicardium\nMyocardium\nEndocardium\r\nSA node\tPacemaker",
    );

    expect(result.cards).toEqual([
      { front: "Layers of the heart", back: "Epicardium\nMyocardium\nEndocardium" },
      { front: "SA node", back: "Pacemaker" },
    ]);
  });

  it("splits on the first separator only, so a comma in the answer survives", () => {
    const result = parseImportedCards("Atria,Left, right;Ventricles,Left, right", {
      sideSeparator: ",",
      cardSeparator: ";",
    });

    expect(result.cards).toEqual([
      { front: "Atria", back: "Left, right" },
      { front: "Ventricles", back: "Left, right" },
    ]);
  });

  it("counts cards that came through with one side", () => {
    const result = parseImportedCards("Just a term\nSA node\tPacemaker\n\tOrphan");

    expect(result.cards).toHaveLength(3);
    expect(result.incomplete).toBe(2);
  });

  it("finds nothing in nothing", () => {
    expect(parseImportedCards("  \n\n").cards).toEqual([]);
  });
});

describe("guessSideSeparator", () => {
  it("prefers a tab, then a dash, then a comma", () => {
    expect(guessSideSeparator("a\tb, c\nd\te")).toBe("\t");
    expect(guessSideSeparator("a - b\nc - d")).toBe(" - ");
    expect(guessSideSeparator("a,b\nc,d")).toBe(",");
    expect(guessSideSeparator("")).toBe("\t");
  });
});
