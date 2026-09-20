/**
 * DOCX extraction tests.
 *
 * The fixture is written by the third-party `docx` package (`npm run
 * fixtures`), not hand-rolled XML: a document shaped to match our own parser's
 * assumptions would test nothing.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { extractDocx, parseBlocks, sectionize } from "./docx";
import { classifyLegibility } from "./types";

const FIXTURE = join(import.meta.dirname, "__fixtures__/sample-notes.docx");

async function extract() {
  return extractDocx(await readFile(FIXTURE));
}

describe("extractDocx", () => {
  it("splits the document into sections at its headings", async () => {
    const { units } = await extract();

    expect(units.map((unit) => unit.title)).toEqual([
      "Renal Physiology",
      "ADH",
      "Aldosterone",
      "Acid-Base Balance",
    ]);
  });

  it("numbers sections from 1 so provenance links resolve", async () => {
    const { units } = await extract();
    expect(units.map((unit) => unit.index)).toEqual([1, 2, 3, 4]);
  });

  it("keeps each section's prose with its own heading", async () => {
    const { units } = await extract();
    const adh = units.find((unit) => unit.title === "ADH")!;

    expect(adh.rawText).toContain("posterior pituitary");
    expect(adh.rawText).toContain("collecting duct");
    // Prose from a neighbouring section must not bleed into this one, or every
    // excerpt drawn from it would cite the wrong place.
    expect(adh.rawText).not.toContain("electrolyte balance");
    expect(adh.rawText).not.toContain("bicarbonate");
  });

  it("extracts a table as rows and columns rather than a run of words", async () => {
    const { units } = await extract();
    const adh = units.find((unit) => unit.title === "ADH")!;

    expect(adh.tables).toHaveLength(1);
    expect(adh.tables[0].rows).toEqual([
      ["Hormone", "Origin", "Action"],
      ["ADH", "Hypothalamus", "Water reabsorption"],
      ["Aldosterone", "Adrenal cortex", "Sodium reabsorption"],
    ]);
  });

  it("attaches a table to the section it appears in", async () => {
    const { units } = await extract();
    for (const unit of units) {
      if (unit.title !== "ADH") expect(unit.tables).toHaveLength(0);
    }
  });

  it("keeps runs within a paragraph together", async () => {
    const { units } = await extract();
    const acidBase = units.find((unit) => unit.title === "Acid-Base Balance")!;

    // The fixture splits this sentence across two runs in the XML.
    expect(acidBase.rawText).toContain(
      "The bicarbonate buffer system is the primary extracellular buffer.",
    );
  });

  it("reports no warnings for a well-formed document", async () => {
    const { warnings } = await extract();
    expect(warnings).toEqual([]);
  });

  it("marks every section as legible", async () => {
    const { units } = await extract();
    for (const unit of units) {
      expect(classifyLegibility(unit)).toBe("ok");
    }
  });
});

describe("sectioning rules", () => {
  it("starts a new section at an explicit page break", () => {
    const units = sectionize(
      parseBlocks("<p>Before the break.</p><p><hr /></p><p>After it.</p>"),
    );

    expect(units).toHaveLength(2);
    expect(units[0].rawText).toContain("Before the break");
    expect(units[1].rawText).toContain("After it");
  });

  it("keeps a deeper heading inside the section it introduces", () => {
    const units = sectionize(
      parseBlocks(
        "<h1>Renal</h1><p>Intro.</p><h3>Detail</h3><p>More.</p><h2>ADH</h2><p>Body.</p>",
      ),
    );

    expect(units).toHaveLength(2);
    expect(units[0].rawText).toContain("Detail");
    expect(units[0].rawText).toContain("More.");
  });

  it("keeps text that appears before the first heading", () => {
    const units = sectionize(
      parseBlocks("<p>Course overview.</p><h1>Renal</h1><p>Body.</p>"),
    );

    expect(units).toHaveLength(2);
    expect(units[0].rawText).toContain("Course overview");
    expect(units[0].title).toBeNull();
  });

  it("chunks a document with no headings instead of emitting one blob", () => {
    const html = Array.from(
      { length: 40 },
      (_, i) => `<p>Paragraph number ${i + 1} of the notes.</p>`,
    ).join("");

    const units = sectionize(parseBlocks(html));

    // One enormous unit would make every card cite "section 1", which is the
    // same as citing nothing.
    expect(units.length).toBeGreaterThan(1);
    expect(units[0].rawText).toContain("Paragraph number 1");
    expect(units.at(-1)?.rawText).toContain("Paragraph number 40");
  });

  it("turns list items into separate lines", () => {
    const units = sectionize(
      parseBlocks("<ul><li>First point</li><li>Second point</li></ul>"),
    );

    expect(units[0].rawText.split("\n")).toEqual([
      "First point",
      "Second point",
    ]);
  });

  it("decodes entities so excerpts match the source text", () => {
    const units = sectionize(
      parseBlocks("<p>Na&#43; &amp; K&#43; balance &lt;5 mmol</p>"),
    );

    expect(units[0].rawText).toBe("Na+ & K+ balance <5 mmol");
  });

  it("pads a ragged table so every row has the same width", () => {
    const units = sectionize(
      parseBlocks(
        "<table><tr><td>A</td><td>B</td><td>C</td></tr><tr><td>D</td></tr></table>",
      ),
    );

    expect(units[0].tables[0].rows).toEqual([
      ["A", "B", "C"],
      ["D", "", ""],
    ]);
  });
});
