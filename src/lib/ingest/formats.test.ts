/**
 * Plain text, Markdown, RTF, and CSV extraction.
 *
 * Every one of these formats is a wall of text with no page numbers, so the
 * tests are mostly about whether the chunking produces provenance a student
 * could actually follow back.
 */
import { describe, expect, it } from "vitest";

import { extractCsvText, looksLikeHeader, parseCsv } from "./csv";
import { rtfToText } from "./rtf";
import { extractPlainText, PARAGRAPHS_PER_SECTION } from "./text";

describe("markdown", () => {
  it("splits at headings and keeps each section's own body", () => {
    const { units } = extractPlainText(
      `# Renal Physiology\n\nThe kidney filters plasma.\n\n## ADH\n\nReleased from the posterior pituitary.\n\n## Aldosterone\n\nActs on the distal tubule.`,
    );

    expect(units.map((unit) => unit.title)).toEqual([
      "Renal Physiology",
      "ADH",
      "Aldosterone",
    ]);
    expect(units[1].rawText).toContain("posterior pituitary");
    expect(units[1].rawText).not.toContain("distal tubule");
  });

  it("reads an underlined heading as a heading", () => {
    const { units } = extractPlainText(
      `Renal Physiology\n===\n\nThe kidney filters plasma.\n\nADH\n---\n\nFrom the posterior pituitary.`,
    );

    expect(units.map((unit) => unit.title)).toEqual([
      "Renal Physiology",
      "ADH",
    ]);
  });

  it("keeps text that appears before the first heading", () => {
    const { units } = extractPlainText(
      `Course overview for week 3.\n\n# Renal\n\nBody.`,
    );

    expect(units[0].title).toBeNull();
    expect(units[0].rawText).toContain("Course overview");
  });

  it("numbers sections from 1 so provenance links resolve", () => {
    const { units } = extractPlainText(`# A\n\nx\n\n# B\n\ny`);
    expect(units.map((unit) => unit.index)).toEqual([1, 2]);
  });
});

describe("plain text", () => {
  it("groups paragraphs instead of emitting one blob", () => {
    const content = Array.from(
      { length: 40 },
      (_, i) => `Paragraph ${i + 1} of the notes.`,
    ).join("\n\n");

    const { units } = extractPlainText(content);

    expect(units.length).toBe(Math.ceil(40 / PARAGRAPHS_PER_SECTION));
    expect(units[0].rawText).toContain("Paragraph 1 ");
    expect(units.at(-1)?.rawText).toContain("Paragraph 40");
  });

  it("warns rather than failing on an empty file", () => {
    const { units, warnings } = extractPlainText("   \n\n  ");
    expect(units).toEqual([]);
    expect(warnings[0].code).toBe("no_units");
  });
});

describe("rtf", () => {
  const RTF = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0\fnil Helvetica;}}
{\colortbl;\red0\green0\blue0;}
\f0\fs24 ADH is released from the posterior pituitary.\par
It \b increases\b0  water reabsorption.\par
Caf\'e9 and 50\% of cases.\par}`;

  it("keeps the words and drops the control words", () => {
    const text = rtfToText(RTF);

    expect(text).toContain("ADH is released from the posterior pituitary.");
    expect(text).toContain("It increases water reabsorption.");
    expect(text).not.toContain("fonttbl");
    expect(text).not.toContain("\\par");
    expect(text).not.toMatch(/\\f0/);
  });

  it("decodes escaped bytes and literal braces", () => {
    expect(rtfToText(RTF)).toContain("Café");
    expect(rtfToText(String.raw`{\rtf1 a \{b\} c\par}`)).toContain("a {b} c");
  });

  it("decodes unicode escapes", () => {
    // Written with explicit backslashes: String.raw does not protect a valid
    // \u escape, so the fixture would arrive already decoded.
    expect(rtfToText("{\\rtf1 5 \\u8804? 10\\par}")).toContain("5 \u2264 10");
  });

  it("chunks the recovered text like any other plain text", () => {
    const { units } = extractPlainText(rtfToText(RTF));
    expect(units).toHaveLength(1);
    expect(units[0].rawText).toContain("posterior pituitary");
  });
});

describe("csv", () => {
  const CSV = `Hormone,Origin,Action
ADH,Hypothalamus,"Increases water reabsorption, in the collecting duct"
Aldosterone,Adrenal cortex,Increases sodium reabsorption`;

  it("parses quoted fields containing commas", () => {
    const rows = parseCsv(CSV);
    expect(rows).toHaveLength(3);
    expect(rows[1][2]).toBe("Increases water reabsorption, in the collecting duct");
  });

  it("parses escaped quotes and newlines inside a field", () => {
    const rows = parseCsv(`a,"say ""hi""","line one\nline two"`);
    expect(rows[0][1]).toBe('say "hi"');
    expect(rows[0][2]).toBe("line one\nline two");
  });

  it("keeps the table as rows and columns", () => {
    const { units } = extractCsvText(CSV);

    expect(units).toHaveLength(1);
    expect(units[0].tables[0].rows[0]).toEqual(["Hormone", "Origin", "Action"]);
    expect(units[0].tables[0].rows[2][1]).toBe("Adrenal cortex");
  });

  it("writes each row out as text so an excerpt can quote it", () => {
    const { units } = extractCsvText(CSV);

    // Provenance is checked against text, so the text has to carry the data.
    expect(units[0].rawText).toContain("Hormone: ADH");
    expect(units[0].rawText).toContain("Origin: Hypothalamus");
  });

  it("splits a long file into findable sections", () => {
    const rows = ["Term,Definition"];
    for (let i = 1; i <= 60; i += 1) rows.push(`Term ${i},Definition ${i}`);

    const { units } = extractCsvText(rows.join("\n"));

    expect(units.length).toBeGreaterThan(1);
    expect(units[0].title).toMatch(/Rows 1/);
    // The header rides along with every section, or the columns lose meaning.
    expect(units[1].tables[0].rows[0]).toEqual(["Term", "Definition"]);
  });

  it("recognises a header row, and copes without one", () => {
    expect(looksLikeHeader(parseCsv(CSV))).toBe(true);

    const { units } = extractCsvText("1,2,3\n4,5,6");
    expect(units[0].rawText).toContain("1 | 2 | 3");
  });

  it("pads ragged rows so every row has the same width", () => {
    const { units } = extractCsvText("A,B,C\n1,2,3\n4");
    expect(units[0].tables[0].rows.at(-1)).toEqual(["4", "", ""]);
  });

  it("warns on an empty file", () => {
    expect(extractCsvText("").warnings[0].code).toBe("no_units");
  });
});
