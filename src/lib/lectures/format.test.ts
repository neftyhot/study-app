import { describe, expect, it } from "vitest";

import {
  formatDuration,
  formatTimestamp,
  toDeckNotes,
  toSrt,
  toTimestampedText,
} from "./format";

const segment = (id: number, start: number, end: number, text: string) => ({ id, start, end, text });

describe("timestamps", () => {
  it("adds hours only when there are some", () => {
    expect(formatTimestamp(247.9)).toBe("4:07");
    expect(formatTimestamp(3847)).toBe("1:04:07");
    expect(formatTimestamp(Number.NaN)).toBe("0:00");
  });

  it("describes a length", () => {
    expect(formatDuration(40)).toBe("40 sec");
    expect(formatDuration(3134)).toBe("52 min");
    expect(formatDuration(3840)).toBe("1 hr 4 min");
    expect(formatDuration(7200)).toBe("2 hr");
    expect(formatDuration(null)).toBe("");
  });
});

describe("exports", () => {
  const segments = [segment(0, 0, 2.5, "Hello."), segment(1, 3847.25, 3850, "Goodbye.")];

  it("writes SubRip", () => {
    expect(toSrt(segments)).toBe(
      "1\n00:00:00,000 --> 00:00:02,500\nHello.\n\n2\n01:04:07,250 --> 01:04:10,000\nGoodbye.\n",
    );
  });

  it("writes a line per segment", () => {
    expect(toTimestampedText(segments)).toBe("[0:00] Hello.\n[1:04:07] Goodbye.");
  });
});

describe("toDeckNotes", () => {
  // Twelve minutes of one sentence every twenty seconds.
  const segments = Array.from({ length: 36 }, (_, i) =>
    segment(i, i * 20, i * 20 + 20, `Sentence ${i}.`),
  );

  it("starts a section about every five minutes", () => {
    const notes = toDeckNotes("Bio 101", segments);
    expect(notes.startsWith("# Bio 101\n")).toBe(true);
    expect(notes.match(/^## .+$/gm)).toEqual(["## 0:00 – 5:00", "## 5:00 – 10:00", "## 10:00 – 12:00"]);
    expect(notes).toContain("Sentence 0. Sentence 1.");
  });

  it("falls back to the text when there are no segments", () => {
    expect(toDeckNotes("Bio 101", [], "Just the text.")).toContain("Just the text.");
  });
});
