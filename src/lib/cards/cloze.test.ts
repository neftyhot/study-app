import { describe, expect, it } from "vitest";

import {
  BLANK,
  clozeAnswers,
  clozeQuestion,
  clozeRevealed,
  hasCloze,
  parseCloze,
} from "./cloze";

const SENTENCE = "ADH is released from the {{posterior pituitary}} in response to {{rising osmolality}}.";

describe("cloze", () => {
  it("splits a sentence into shown and hidden parts", () => {
    expect(parseCloze(SENTENCE)).toEqual([
      { text: "ADH is released from the ", hidden: false },
      { text: "posterior pituitary", hidden: true },
      { text: " in response to ", hidden: false },
      { text: "rising osmolality", hidden: true },
      { text: ".", hidden: false },
    ]);
  });

  it("blanks every deletion to the same width, so length is not a hint", () => {
    const question = clozeQuestion(SENTENCE);
    expect(question).toBe(
      `ADH is released from the ${BLANK} in response to ${BLANK}.`,
    );
    expect(question).not.toContain("pituitary");
  });

  it("puts the sentence back together for the reveal", () => {
    expect(clozeRevealed(SENTENCE)).toBe(
      "ADH is released from the posterior pituitary in response to rising osmolality.",
    );
  });

  it("lists what is hidden, in order", () => {
    expect(clozeAnswers(SENTENCE)).toEqual([
      "posterior pituitary",
      "rising osmolality",
    ]);
  });

  it("recognises a sentence with no deletion in it", () => {
    expect(hasCloze("Just a sentence.")).toBe(false);
    expect(clozeQuestion("Just a sentence.")).toBe("Just a sentence.");
    // A stateful regex is a classic way for the second call to disagree with
    // the first, so it is checked twice on purpose.
    expect(hasCloze(SENTENCE)).toBe(true);
    expect(hasCloze(SENTENCE)).toBe(true);
  });

  it("parses the whole sentence after it has been tested", () => {
    // A shared /g regex keeps its lastIndex between calls, so this once
    // dropped the first deletion — the answer was "rising osmolality" alone.
    expect(hasCloze(SENTENCE)).toBe(true);
    expect(clozeAnswers(SENTENCE)).toEqual([
      "posterior pituitary",
      "rising osmolality",
    ]);
  });

  it("ignores an unclosed brace rather than swallowing the rest", () => {
    expect(clozeQuestion("Half a {{deletion")).toBe("Half a {{deletion");
  });
});
