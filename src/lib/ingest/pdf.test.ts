import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { extractPdf } from "./pdf";

const doc = readFileSync(join(__dirname, "__fixtures__/sample-notes.pdf"));

describe("extractPdf", () => {
  it("extracts one unit per page, 1-based", async () => {
    const { units } = await extractPdf(doc);

    expect(units).toHaveLength(4);
    expect(units.map((u) => u.index)).toEqual([1, 2, 3, 4]);
  });

  it("keeps page content aligned with its page number", async () => {
    const { units } = await extractPdf(doc);

    for (const unit of units.slice(0, 3)) {
      expect(unit.title).toBe(`Page ${unit.index} Heading`);
      expect(unit.rawText).toContain(`Content for page ${unit.index}.`);
    }
  });

  it("flags a text-free page instead of dropping it", async () => {
    const { units, warnings } = await extractPdf(doc);

    // The blank page is still a real page and keeps its index.
    expect(units[3].index).toBe(4);
    expect(units[3].rawText).toBe("");
    expect(warnings.some((w) => w.index === 4)).toBe(true);
  });

  it("reports no speaker notes or tables for PDFs", async () => {
    const { units } = await extractPdf(doc);

    expect(units.every((u) => u.speakerNotes === null)).toBe(true);
    expect(units.every((u) => u.tables.length === 0)).toBe(true);
  });
});
