import { describe, expect, it } from "vitest";

import type { StudyProgress } from "../types";
import { flipGradeRow, forMode, learnOutcomeRow } from "./record";

const NOW = "2026-10-21T12:00:00.000Z";
const TODAY = "2026-10-21";

function progress(patch: Partial<StudyProgress> = {}): StudyProgress {
  return {
    id: "p1",
    flashcardId: "c1",
    state: "unstudied",
    intervalDays: 0,
    nextReviewDue: null,
    ease: 2.3,
    lastCreditedAt: null,
    lastGrade: null,
    lastReviewedAt: null,
    recognitionCount: 0,
    immediateRecallCount: 0,
    retentionCount: 0,
    lapses: 0,
    masteredPoints: [],
    updatedAt: null,
    deletedAt: null,
    ...patch,
  };
}

describe("flipGradeRow", () => {
  it("promotes a new card to recognition and schedules it", () => {
    const row = flipGradeRow(undefined, "easy", { now: NOW, today: TODAY });
    expect(row.state).toBe("recognition");
    expect(row.recognitionCount).toBe(1);
    expect(row.lastGrade).toBe("easy");
    expect(row.lastReviewedAt).toBe(NOW);
    expect(row.nextReviewDue).not.toBeNull();
    expect(row.retentionCount).toBe(0);
  });

  it("records a lapse and steps a retained card down one tier, not to zero", () => {
    const row = flipGradeRow(progress({ state: "retained", retentionCount: 2 }), "missed", {
      now: NOW,
      today: TODAY,
    });
    expect(row.state).toBe("immediate_recall");
    expect(row.lapses).toBe(1);
    expect(row.retentionCount).toBe(2);
  });

  it("never credits retention however often it is easy", () => {
    let current: StudyProgress | undefined;
    for (let i = 0; i < 5; i++) {
      current = progress({ ...current, ...flipGradeRow(current, "easy", { now: NOW, today: TODAY }) });
    }
    expect(current?.retentionCount).toBe(0);
    expect(current?.state).toBe("recognition");
  });
});

describe("forMode", () => {
  it("leaves long-term schedules alone", () => {
    expect(forMode({ nextReviewDue: "2026-11-30" }, "longterm", TODAY).nextReviewDue).toBe("2026-11-30");
  });

  it("pulls a cram card in to tomorrow", () => {
    expect(forMode({ nextReviewDue: "2026-11-30" }, "cram", TODAY).nextReviewDue).toBe("2026-10-22");
    expect(forMode({ nextReviewDue: null }, "cram", TODAY).nextReviewDue).toBe("2026-10-22");
    expect(forMode({ nextReviewDue: TODAY }, "cram", TODAY).nextReviewDue).toBe(TODAY);
  });
});

describe("learnOutcomeRow", () => {
  it("credits a correct MCQ as recognition only", () => {
    const row = learnOutcomeRow(
      undefined,
      { stage: "mcq", countsTowardMastery: true },
      { correct: true, verdict: "correct" },
      "longterm",
      { now: NOW, today: TODAY },
    );
    expect(row.state).toBe("recognition");
    expect(row.lastReviewedAt).toBe(NOW);
  });

  it("schedules a guessed answer as no proof of recall", () => {
    const row = learnOutcomeRow(
      progress({ state: "immediate_recall", immediateRecallCount: 1 }),
      { stage: "typed_delayed", countsTowardMastery: true },
      { correct: true, guessed: true, verdict: "correct" },
      "longterm",
      { now: NOW, today: TODAY },
    );
    expect(row.retentionCount).toBe(0);
  });

  it("applies cram mode on top of the schedule", () => {
    const row = learnOutcomeRow(
      undefined,
      { stage: "typed_immediate", countsTowardMastery: true },
      { correct: true, verdict: "correct" },
      "cram",
      { now: NOW, today: TODAY },
    );
    expect(row.nextReviewDue! <= "2026-10-22").toBe(true);
  });
});
