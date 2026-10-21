import { describe, expect, it } from "vitest";

import { sectionSpeech, speechText } from "@/lib/speech/read-aloud";

describe("what read aloud says", () => {
  it("reads the question, then the answer", () => {
    const card = { question: "What is ATP?", directAnswer: "The cell's **energy** currency" };
    expect(speechText(card, "question")).toBe("What is ATP?");
    expect(speechText(card, "answer")).toBe("The cell's energy currency");
  });

  it("says 'blank' for a cloze gap and never reads the hidden word early", () => {
    const card = { question: "The {{mitochondria}} makes ATP", directAnswer: "mitochondria", cardType: "cloze" };
    const question = speechText(card, "question");
    expect(question).toBe("The blank makes ATP");
    expect(question).not.toContain("mitochondria");
    expect(speechText(card, "answer")).toBe("The mitochondria makes ATP");
  });
});

describe("reading a study-guide concept", () => {
  it("says the name, the explanation, then the example", () => {
    const text = sectionSpeech({
      conceptName: "Osmosis",
      definition: [{ text: "Water moves across a membrane." }],
      breakdown: [{ text: "From low to high solute." }],
      example: [{ text: "A raisin swells in water." }],
    });
    expect(text).toBe("Osmosis. Water moves across a membrane. From low to high solute. For example: A raisin swells in water.");
  });
});
