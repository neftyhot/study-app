import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { extractPptx } from "./pptx";

const deck = readFileSync(
  join(__dirname, "__fixtures__/sample-deck.pptx"),
);

describe("extractPptx", () => {
  it("extracts every slide", async () => {
    const { units } = await extractPptx(deck);
    expect(units).toHaveLength(12);
  });

  it("numbers slides 1-based in presentation order, not filename order", async () => {
    const { units } = await extractPptx(deck);

    expect(units.map((u) => u.index)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);

    // The regression that matters: a naive filename sort puts slide10 before
    // slide2, so slide 2's content would be filed under index 2 incorrectly.
    // Each fixture slide names itself, so content and index must agree.
    for (const unit of units) {
      expect(unit.title).toBe(`Slide ${unit.index} Title`);
      expect(unit.rawText).toContain(`Body line one for slide ${unit.index}`);
    }
  });

  it("extracts speaker notes per slide", async () => {
    const { units } = await extractPptx(deck);

    expect(units[0].speakerNotes).toContain("Speaker notes for slide 1.");
    expect(units[9].speakerNotes).toContain("Speaker notes for slide 10.");
    expect(units.every((u) => u.speakerNotes !== null)).toBe(true);
  });

  it("preserves bullet structure as separate lines", async () => {
    const { units } = await extractPptx(deck);
    const lines = units[0].rawText.split("\n");

    expect(lines).toContain("Body line one for slide 1");
    expect(lines).toContain("Body line two for slide 1");
  });

  it("extracts tables as rows without duplicating cells into rawText", async () => {
    const { units } = await extractPptx(deck);
    const slide5 = units[4];

    expect(slide5.tables).toHaveLength(1);
    expect(slide5.tables[0].rows[0]).toEqual(["Hormone", "Origin", "Action"]);
    expect(slide5.tables[0].rows[1]).toEqual([
      "ADH",
      "Posterior pituitary",
      "Water reabsorption",
    ]);

    // Cell text belongs to `tables`, not `rawText`.
    expect(slide5.rawText).not.toContain("Posterior pituitary");
  });

  it("pads ragged table rows to a uniform width", async () => {
    const { units } = await extractPptx(deck);
    const rows = units[4].tables[0].rows;
    const widths = new Set(rows.map((r) => r.length));

    expect(widths.size).toBe(1);
  });
});
