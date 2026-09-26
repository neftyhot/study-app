import { describe, expect, it } from "vitest";

import { deckNameFrom, guessRole, isAccepted } from "./quick-start";

describe("guessRole", () => {
  it("spots a study guide by name", () => {
    expect(guessRole("Exam 2 Study Guide.pdf")).toBe("study_guide");
    expect(guessRole("review_sheet.docx")).toBe("study_guide");
    expect(guessRole("unit-4-objectives.pdf")).toBe("study_guide");
  });

  it("treats everything else as slides", () => {
    expect(guessRole("Lecture 3 - Cell Biology.pptx")).toBe("slides");
  });
});

describe("deckNameFrom", () => {
  it("drops the extension and underscores", () => {
    expect(deckNameFrom("Lecture_3_Cells.pdf")).toBe("Lecture 3 Cells");
    expect(deckNameFrom("Midterm 1.pptx")).toBe("Midterm 1");
  });
});

describe("isAccepted", () => {
  it("takes PDF, PowerPoint and Word, in any case", () => {
    expect(isAccepted("a.PDF")).toBe(true);
    expect(isAccepted("b.pptx")).toBe(true);
    expect(isAccepted("c.docx")).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isAccepted("d.ppt")).toBe(false);
    expect(isAccepted("e.png")).toBe(false);
    expect(isAccepted("pdf")).toBe(false);
  });
});
