/**
 * Export tests.
 *
 * The thing worth testing about an export is not that it ran — it is that the
 * receiving app will read it the way we meant. So: the apkg is opened as a
 * real database and queried, the CSV is parsed back, and the delimited
 * formats are checked against content that would otherwise tear them apart.
 */
import Database from "better-sqlite3";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { ankiTag, backField, buildApkg, fieldChecksum } from "./anki";
import type { DeckExport, ExportCard } from "./cards";
import { csvField, toCsv, toQuizlet, toRemNote } from "./text";

function card(overrides: Partial<ExportCard> = {}): ExportCard {
  return {
    id: crypto.randomUUID(),
    topic: "ADH",
    question: "Where is ADH released from?",
    directAnswer: "The posterior pituitary.",
    fullExplanation: "",
    essentialPoints: ["posterior pituitary"],
    optionalPoints: [],
    commonMisconceptions: [],
    cardType: "atomic",
    professorEmphasis: false,
    starred: false,
    sourceLabel: "Slide 7 of endocrine.pptx",
    sourceExcerpt: "ADH is released from the posterior pituitary.",
    imagePath: null,
    ...overrides,
  };
}

function deck(cards: ExportCard[]): DeckExport {
  return { examId: "exam-1", title: "Exam 2 — Endocrine", cards };
}

describe("CSV", () => {
  it("quotes only the fields RFC 4180 requires", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("has, comma")).toBe('"has, comma"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
  });

  it("round-trips a value containing a comma, a quote and a newline", () => {
    const nasty = 'What is "osmolality", and\nwhy does it matter?';
    const csv = toCsv(deck([card({ question: nasty })]));

    // Parse it back the way a spreadsheet would, rather than trusting the writer.
    const fields = parseCsv(csv);
    expect(fields[0][1]).toBe("Question");
    expect(fields[1][1]).toBe(nasty);
  });

  it("ends every record with CRLF, including the last", () => {
    expect(toCsv(deck([card()]))).toMatch(/\r\n$/);
  });
});

describe("Quizlet", () => {
  it("removes the separator from content that would otherwise split a card", () => {
    const text = toQuizlet(
      deck([card({ question: "Sodium\tand water", directAnswer: "Retained.\nBoth." })]),
    );

    const rows = text.split("\n");
    expect(rows).toHaveLength(1);
    expect(rows[0].split("\t")).toHaveLength(2);
    expect(rows[0]).toContain("Sodium and water");
    expect(rows[0]).toContain("Retained. · Both.");
  });

  it("swaps semicolons out of content when semicolon is the separator", () => {
    const text = toQuizlet(deck([card({ directAnswer: "a; b" })]), {
      termSeparator: "semicolon",
    });

    expect(text.split(";")).toHaveLength(2);
    expect(text).toContain("a, b");
  });
});

describe("RemNote", () => {
  it("uses :: for a bare card and ::: when there is detail underneath", () => {
    const markdown = toRemNote(
      deck([
        card({
          topic: "Simple",
          essentialPoints: [],
          sourceLabel: "",
          question: "Q1",
        }),
        card({ topic: "Detailed", question: "Q2", sourceLabel: "Slide 3 of a.pdf" }),
      ]),
    );

    expect(markdown).toContain("- Q1 :: The posterior pituitary.");
    expect(markdown).toContain("- Q2 ::: The posterior pituitary.");
    expect(markdown).toContain("    - Source: Slide 3 of a.pdf");
  });

  it("keeps an answer on one line so indentation still means hierarchy", () => {
    const markdown = toRemNote(
      deck([card({ directAnswer: "First.\nSecond.", essentialPoints: [], sourceLabel: "" })]),
    );

    expect(markdown).toContain(":: First. Second.");
  });
});

describe("Anki", () => {
  it("writes a collection Anki's importer can read", async () => {
    const buffer = await buildApkg(
      deck([
        card({ question: "Q1", topic: "ADH" }),
        card({ question: "Q2", topic: "Aldosterone", professorEmphasis: true }),
      ]),
    );

    const zip = await JSZip.loadAsync(buffer);
    expect(Object.keys(zip.files).sort()).toEqual(["collection.anki2", "media"]);

    const sqlite = new Database(
      Buffer.from(await zip.file("collection.anki2")!.async("nodebuffer")),
    );

    const col = sqlite.prepare("SELECT * FROM col").get() as Record<string, unknown>;
    expect(col.ver).toBe(11);

    const models = JSON.parse(col.models as string) as Record<string, { flds: unknown[] }>;
    const model = Object.values(models)[0];
    expect(model.flds).toHaveLength(2);

    const notes = sqlite
      .prepare("SELECT * FROM notes ORDER BY id")
      .all() as { flds: string; tags: string; sfld: string; csum: number }[];
    expect(notes).toHaveLength(2);

    // Fields are joined by U+001F; a note that loses it imports as one field.
    expect(notes[0].flds.split("\u001f")).toHaveLength(2);
    expect(notes[0].sfld).toBe("Q1");
    expect(notes[0].csum).toBe(fieldChecksum("Q1"));
    expect(notes[1].tags).toContain("Aldosterone");
    expect(notes[1].tags).toContain("professor_emphasis");

    // Every note needs its card row, or the deck imports empty.
    const cards = sqlite
      .prepare("SELECT * FROM cards ORDER BY due")
      .all() as { nid: number; due: number; did: number }[];
    expect(cards.map((row) => row.due)).toEqual([1, 2]);
    expect(new Set(cards.map((row) => row.did)).size).toBe(1);

    sqlite.close();
  });

  it("stores an image under its manifest number and references it from the card", async () => {
    const withImage = card({ question: "Label this" });
    const buffer = await buildApkg(deck([withImage]), {
      media: new Map([
        [withImage.id, { name: "slide-7.png", data: Buffer.from("PNGDATA") }],
      ]),
    });

    const zip = await JSZip.loadAsync(buffer);
    const manifest = JSON.parse(await zip.file("media")!.async("string"));
    expect(manifest).toEqual({ "0": "slide-7.png" });
    expect(await zip.file("0")!.async("string")).toBe("PNGDATA");

    const sqlite = new Database(
      Buffer.from(await zip.file("collection.anki2")!.async("nodebuffer")),
    );
    const note = sqlite.prepare("SELECT flds FROM notes").get() as { flds: string };
    expect(note.flds).toContain('<img src="slide-7.png">');
    sqlite.close();
  });

  it("stores a picture once however many cards cite its slide", async () => {
    const cards = [card({ question: "Q1" }), card({ question: "Q2" }), card({ question: "Q3" })];
    const picture = { name: "slide-7.png", data: Buffer.from("PNGDATA") };

    const buffer = await buildApkg(deck(cards), {
      media: new Map(cards.map((c) => [c.id, picture])),
    });

    const zip = await JSZip.loadAsync(buffer);
    const manifest = JSON.parse(await zip.file("media")!.async("string"));
    expect(Object.values(manifest)).toEqual(["slide-7.png"]);

    // Every card still points at it.
    const sqlite = new Database(
      Buffer.from(await zip.file("collection.anki2")!.async("nodebuffer")),
    );
    const notes = sqlite.prepare("SELECT flds FROM notes").all() as { flds: string }[];
    expect(notes.every((note) => note.flds.includes('<img src="slide-7.png">'))).toBe(true);
    sqlite.close();
  });

  it("escapes HTML so a < in the material is not read as markup", () => {
    const back = backField(card({ directAnswer: "PO2 < 60 mmHg & falling" }), null);
    expect(back).toContain("PO2 &lt; 60 mmHg &amp; falling");
  });

  it("strips whitespace from tags, which Anki would otherwise split", () => {
    expect(ankiTag("Exam 2 — Endocrine")).toBe("Exam_2_—_Endocrine");
    expect(ankiTag(' "quoted" ')).toBe("quoted");
  });
});

/** A minimal RFC 4180 reader, so the CSV test does not grade its own work. */
function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += char;
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r" && input[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else field += char;
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
