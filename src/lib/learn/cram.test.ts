import { describe, expect, it } from "vitest";

import {
  applyOutcome,
  isComplete,
  nextStep,
  startRound,
  type Outcome,
  type RoundState,
} from "./ladder";
import { forMode, startingFrom } from "./session";

/** Answers whatever the ladder asks next; returns the step answered too. */
function answer(state: RoundState, outcome: Outcome) {
  const step = nextStep(state);
  if (!step) throw new Error("round is over");
  return { state: applyOutcome(state, step, outcome), step };
}

/** Plays a round, getting `missFirst` wrong the first time it comes up. */
function play(state: RoundState, missFirst?: string) {
  const asked: string[] = [];
  let missed = false;
  while (!isComplete(state)) {
    const step = nextStep(state)!;
    const wrong: boolean = step.cardId === missFirst && !missed;
    missed ||= wrong;
    asked.push(`${step.cardId}:${step.stage}`);
    state = applyOutcome(state, step, { correct: !wrong });
  }
  return { state, asked };
}

const IDS = ["a", "b", "c", "d", "e", "f"];

describe("learn modes", () => {
  it("starts long-term unless cramming is chosen", () => {
    expect(startRound(IDS).mode).toBe("longterm");
    expect(startRound(IDS, { mode: "cram" }).mode).toBe("cram");
  });

  it("keeps the mode as the round goes on", () => {
    let state = startRound(IDS, { mode: "cram" });
    for (let i = 0; i < 5; i++) state = answer(state, { correct: true }).state;
    expect(state.mode).toBe("cram");
  });

  it("brings a card back sooner when cramming", () => {
    // mcq, typed_immediate, then interleaved: the gap is the mode's.
    const dueAfterImmediate = (mode: "longterm" | "cram") => {
      let state = startRound(["a"], { mode });
      state = answer(state, { correct: true }).state;
      state = answer(state, { correct: true }).state;
      return state.concepts[0].dueAt - state.step;
    };
    expect(dueAfterImmediate("cram")).toBeLessThan(
      dueAfterImmediate("longterm"),
    );
  });

  it("gives a missed card one extra delayed check when cramming", () => {
    const cram = play(startRound(IDS, { mode: "cram" }), "c");
    const longterm = play(startRound(IDS), "c");
    const delayed = (asked: string[]) =>
      asked.filter((entry) => entry === "c:typed_delayed").length;
    expect(delayed(cram.asked)).toBe(2);
    expect(delayed(longterm.asked)).toBe(1);
  });

  it("does not add the extra check for a card never missed", () => {
    const { asked } = play(startRound(IDS, { mode: "cram" }));
    expect(asked.filter((entry) => entry.endsWith(":typed_delayed"))).toHaveLength(
      IDS.length,
    );
  });

  it("treats a round saved before modes existed as long-term", () => {
    const saved = startRound(IDS);
    delete saved.mode;
    const { asked } = play(saved, "c");
    expect(asked.filter((entry) => entry === "c:typed_delayed")).toHaveLength(1);
  });
});

describe("cram scheduling", () => {
  const schedule = { nextReviewDue: "2026-10-20", intervalDays: 21 };

  it("brings every card back tomorrow, keeping its interval", () => {
    expect(forMode(schedule, "cram", "2026-09-29")).toEqual({
      nextReviewDue: "2026-09-30",
      intervalDays: 21,
    });
  });

  it("leaves a card due sooner alone", () => {
    const soon = { nextReviewDue: "2026-09-29", intervalDays: 0 };
    expect(forMode(soon, "cram", "2026-09-29")).toBe(soon);
  });

  it("leaves long-term scheduling alone", () => {
    expect(forMode(schedule, "longterm", "2026-09-29")).toBe(schedule);
    expect(forMode(schedule, undefined, "2026-09-29")).toBe(schedule);
  });
});

describe("starting at a card", () => {
  const lecture = ["c1", "c2", "c3", "c4", "c5"];

  it("runs the deck from the chosen card", () => {
    expect(startingFrom(lecture, lecture, "c3")).toEqual(["c3", "c4", "c5"]);
  });

  it("starts at the next queued card when the chosen one is not queued", () => {
    expect(startingFrom(["c1", "c2", "c4", "c5"], lecture, "c3")).toEqual([
      "c4",
      "c5",
    ]);
  });

  it("starts from the beginning when nothing is left after it", () => {
    expect(startingFrom(["c1", "c2"], lecture, "c4")).toEqual(["c1", "c2"]);
  });

  it("changes nothing without a starting card", () => {
    expect(startingFrom(["c2", "c1"], lecture, null)).toEqual(["c2", "c1"]);
    expect(startingFrom(["c2", "c1"], lecture, "missing")).toEqual(["c2", "c1"]);
  });
});
