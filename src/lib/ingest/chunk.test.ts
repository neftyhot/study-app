import { describe, expect, it } from "vitest";

import { MAX_WORDS, splitLongUnits, splitText, TARGET_WORDS } from "./chunk";
import { extractPlainText } from "./text";

const words = (text: string) => text.split(/\s+/).filter(Boolean);

/** An hour of lecture as transcription tools produce it: one long line. */
function transcript(sentences: number) {
  return Array.from(
    { length: sentences },
    (_, i) => `Sentence number ${i + 1} explains how the olfactory receptors respond to odorant molecules.`,
  ).join(" ");
}

describe("splitText", () => {
  it("leaves a slide-sized section alone", () => {
    const text = transcript(20);
    expect(splitText(text)).toEqual([text]);
  });

  it("cuts a one-line transcript into many pieces, losing nothing", () => {
    const text = transcript(700); // about 8,400 words
    const pieces = splitText(text);

    expect(pieces.length).toBeGreaterThan(25);
    for (const piece of pieces) expect(words(piece).length).toBeLessThanOrEqual(MAX_WORDS);
    expect(pieces.flatMap(words)).toEqual(words(text));
  });

  it("never cuts mid-sentence", () => {
    for (const piece of splitText(transcript(200))) {
      expect(piece.startsWith("Sentence number")).toBe(true);
      expect(piece.endsWith("molecules.")).toBe(true);
    }
  });

  it("prefers paragraph breaks when there are some", () => {
    const paragraph = transcript(8); // ~96 words
    const text = Array.from({ length: 10 }, () => paragraph).join("\n\n");
    for (const piece of splitText(text)) {
      expect(piece.startsWith("Sentence number 1 ")).toBe(true);
    }
  });
});

describe("splitLongUnits", () => {
  it("keeps the heading on every piece and renumbers from 1", () => {
    const units = splitLongUnits([
      { index: 1, title: "Intro", rawText: "Short.", speakerNotes: null, tables: [], imageCount: 0 },
      { index: 2, title: "Olfaction", rawText: transcript(100), speakerNotes: null, tables: [{ rows: [["a"]] }], imageCount: 2 },
    ]);

    expect(units[0].title).toBe("Intro");
    expect(units.map((u) => u.index)).toEqual(units.map((_, i) => i + 1));
    expect(units[1].title).toMatch(/^Olfaction \(1 of \d+\)$/);
    expect(units[1].tables).toHaveLength(1);
    expect(units[2].tables).toHaveLength(0);
    expect(units[2].imageCount).toBe(0);
  });
});

describe("pasted transcripts", () => {
  it("become as many sections as their length warrants", () => {
    const { units } = extractPlainText(transcript(700));
    const expected = Math.round(words(transcript(700)).length / TARGET_WORDS);
    expect(units.length).toBeGreaterThanOrEqual(expected - 3);
  });
});
