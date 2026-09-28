import { describe, expect, it } from "vitest";

import { exactAnswerGrade } from "./typed";

const base = {
  expected: "The mitochondria produce ATP.",
  essentialPoints: ["mitochondria", "ATP", "via oxidative phosphorylation"],
  focusPoints: undefined,
};

describe("exactAnswerGrade", () => {
  it("marks the card's answer, typed word for word, correct", () => {
    const grade = exactAnswerGrade({ ...base, answer: "the Mitochondria produce ATP" });
    expect(grade?.verdict).toBe("correct");
    expect(grade?.missedPoints).toEqual([]);
  });

  it("leaves anything else to the grader", () => {
    expect(exactAnswerGrade({ ...base, answer: "Mitochondria make energy." })).toBeNull();
    expect(exactAnswerGrade({ ...base, answer: "" })).toBeNull();
  });
});
