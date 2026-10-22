import { describe, expect, it } from "vitest";

import { fileKind, readMaterial, rowsAsCards, textAsCards, UnsupportedFileError } from "./ingest";

const file = (name: string, text: string, type: string | null = null) => ({ name, type, bytes: new TextEncoder().encode(text) });

describe("make a deck from a file", () => {
  it("picks the reader by extension, then by type", () => {
    expect(fileKind("Lecture 3.PPTX", null)).toBe("pptx");
    expect(fileKind("notes", "application/pdf")).toBe("pdf");
    expect(fileKind("set.tsv", null)).toBe("csv");
    expect(() => fileKind("old.doc", null)).toThrow(UnsupportedFileError);
    expect(() => fileKind("song.mp3", "audio/mpeg")).toThrow(/can't be read/);
  });

  it("takes a two-column sheet as cards and a wider one as material", () => {
    expect(rowsAsCards([["mitosis", "cell division"], ["ATP", "energy"], ["", ""]])).toEqual([
      { front: "mitosis", back: "cell division" },
      { front: "ATP", back: "energy" },
    ]);
    expect(rowsAsCards([["hormone", "origin", "action"], ["insulin", "pancreas", "lowers glucose"]])).toBeNull();
  });

  it("takes a Quizlet export as cards and prose as notes", () => {
    expect(textAsCards("cell\tbasic unit of life\nATP\tenergy currency")).toEqual([
      { front: "cell", back: "basic unit of life" },
      { front: "ATP", back: "energy currency" },
    ]);
    expect(textAsCards("The cell is the basic unit of life.\nMitochondria make ATP.")).toBeNull();
  });

  it("reads a CSV of pairs as cards and a text file as sections", async () => {
    expect(await readMaterial(file("set.csv", "ATP,energy\nDNA,genes\n"))).toEqual({
      kind: "cards",
      cards: [
        { front: "ATP", back: "energy" },
        { front: "DNA", back: "genes" },
      ],
    });
    const notes = await readMaterial(file("notes.txt", "The cell is the basic unit of life.\n\nMitochondria make ATP."));
    expect(notes.kind).toBe("text");
    if (notes.kind === "text") expect(notes.result.units.length).toBeGreaterThan(0);
    await expect(readMaterial(file("old.ppt", ""))).rejects.toThrow(/\.pptx/);
  });
});
