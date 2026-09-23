import { describe, expect, it } from "vitest";

import { buildMcq, placeCorrect } from "@/lib/learn/mcq";

import { dealPositions } from "./random";

function tally(positions: number[], slots = 4) {
  const counts = Array(slots).fill(0);
  for (const position of positions) counts[position] += 1;
  return counts;
}

describe("dealPositions", () => {
  it("spreads a paper's answers evenly across every slot", () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const counts = tally(dealPositions(Array(20).fill(4), seed));
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
  });

  it("never deals a slot a question does not have", () => {
    const counts = [4, 3, 2, 4, 0, 1, 3];
    dealPositions(counts, 7).forEach((slot, i) => {
      expect(slot).toBeLessThan(Math.max(counts[i], 1));
    });
  });

  it("does not repeat the same pattern paper after paper", () => {
    const patterns = new Set(
      Array.from({ length: 10 }, () => dealPositions(Array(12).fill(4)).join("")),
    );
    expect(patterns.size).toBeGreaterThan(1);
  });
});

describe("buildMcq placement", () => {
  const deck = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"].map(
    (answer, i) => ({
      id: `c${i}`,
      topic: "T",
      question: `Question number ${i}?`,
      directAnswer: answer,
      misconceptions: [],
    }),
  );

  it("puts the correct answer in each slot about equally often", () => {
    const counts = [0, 0, 0, 0];
    for (let seed = 0; seed < 4000; seed += 1) {
      const options = buildMcq(deck[0], deck, { seed });
      counts[options.findIndex((option) => option.correct)] += 1;
    }
    for (const count of counts) {
      expect(count).toBeGreaterThan(850);
      expect(count).toBeLessThan(1150);
    }
  });

  it("moves the correct option to the slot it is dealt", () => {
    const options = buildMcq(deck[0], deck, { seed: 1 });
    for (let slot = 0; slot < options.length; slot += 1) {
      const placed = placeCorrect(options, slot);
      expect(placed[slot].correct).toBe(true);
      expect(placed).toHaveLength(options.length);
    }
  });
});
