/**
 * Density and selection arithmetic.
 *
 * The estimate is the only number shown to a student before a run that costs
 * money and minutes, so what matters is that it is a range, that it tracks the
 * range of pages chosen, and that a custom ratio cannot be pushed somewhere
 * the pipeline would not honour.
 */
import { describe, expect, it } from "vitest";

import {
  ADMIN_MAX_RATIO,
  batchSizeFor,
  blendYield,
  DENSITY_PRESETS,
  isHighDensity,
  MAX_CARDS_PER_BATCH,
  estimateCards,
  expectedFor,
  formatEstimate,
  isDensityMode,
  MAX_RATIO,
  MIN_RATIO,
  ratioFor,
} from "./density";
import { nearestPreset } from "./prompts";
import {
  defaultChoices,
  selectedUnits,
  unitsInRange,
  type SourceOption,
} from "./selection";

const deck: SourceOption = {
  id: "file-1",
  filename: "endocrine.pdf",
  fileType: "pdf",
  units: 96,
  firstIndex: 1,
  lastIndex: 96,
};

describe("ratioFor", () => {
  it("takes a preset's ratio and ignores a custom one", () => {
    expect(ratioFor("standard", 3.9)).toBe(DENSITY_PRESETS.standard.cardsPerUnit);
  });

  it("clamps a custom ratio to what the pipeline will honour", () => {
    expect(ratioFor("custom", 99)).toBe(MAX_RATIO);
    expect(ratioFor("custom", -4)).toBe(MIN_RATIO);
    expect(ratioFor("custom", 1.7)).toBe(1.7);
  });

  it("falls back to standard when custom has no number yet", () => {
    expect(ratioFor("custom", null)).toBe(DENSITY_PRESETS.standard.cardsPerUnit);
  });
});

describe("expectedFor", () => {
  it("estimates from what a preset produces, not what it asks for", () => {
    // Real decks land below what the setting asks for; an estimate built on
    // the request would be high before the run started.
    expect(expectedFor("standard")).toBe(DENSITY_PRESETS.standard.expectedPerUnit);
    expect(expectedFor("standard")).toBeLessThan(
      DENSITY_PRESETS.standard.cardsPerUnit,
    );
  });

  it("scales a custom ratio by what the standard preset delivers", () => {
    const delivered =
      DENSITY_PRESETS.standard.expectedPerUnit /
      DENSITY_PRESETS.standard.cardsPerUnit;
    expect(expectedFor("custom", 2.2)).toBeCloseTo(2.2 * delivered);
    expect(expectedFor("custom", 2.2)).toBeLessThan(2.2);
  });

  it("assumes about two-thirds of a high-density request arrives", () => {
    expect(expectedFor("custom", 30)).toBeCloseTo(20);
    // Ignores history: custom runs each ask for a different ratio.
    expect(expectedFor("custom", 30, null, { cards: 100, units: 100 })).toBeCloseTo(20);
  });

  it("pulls toward this install's measured history", () => {
    const measured = { cards: 100, units: 100 };
    expect(expectedFor("standard", null, null, measured)).toBeCloseTo(
      (DENSITY_PRESETS.standard.expectedPerUnit + 1) / 2,
    );
  });

  it("keeps the presets in order, leanest first", () => {
    expect(DENSITY_PRESETS.high_yield.expectedPerUnit).toBeLessThan(
      DENSITY_PRESETS.standard.expectedPerUnit,
    );
    expect(DENSITY_PRESETS.standard.expectedPerUnit).toBeLessThan(
      DENSITY_PRESETS.exhaustive.expectedPerUnit,
    );
  });
});

describe("estimateCards", () => {
  it("is a range, never a promise", () => {
    const { low, high } = estimateCards(100, 1);
    expect(low).toBeLessThan(high);
    expect(low).toBeLessThanOrEqual(100);
    expect(high).toBeGreaterThanOrEqual(100);
  });

  it("says nothing is selected rather than estimating zero cards", () => {
    expect(formatEstimate(0, 2.5)).toBe("nothing selected");
  });

  it("tracks the material: half the pages, about half the cards", () => {
    const whole = estimateCards(96, 2.5);
    const half = estimateCards(48, 2.5);
    expect(half.high).toBeLessThan(whole.high);
    expect(half.high * 2).toBeCloseTo(whole.high, 0);
  });
});

describe("nearestPreset", () => {
  it("borrows the prose of the preset a custom ratio sits closest to", () => {
    expect(nearestPreset(0.2)).toBe("high_yield");
    expect(nearestPreset(1.1)).toBe("standard");
    expect(nearestPreset(3.5)).toBe("exhaustive");
  });
});

describe("unitsInRange", () => {
  it("counts the whole file when nothing was narrowed", () => {
    expect(unitsInRange(deck, defaultChoices([deck])[deck.id])).toBe(96);
  });

  it("counts a range by its overlap with the file's real page numbers", () => {
    expect(
      unitsInRange(deck, { included: true, whole: false, from: 10, to: 19 }),
    ).toBe(10);
  });

  it("does not count pages past the end of the file", () => {
    expect(
      unitsInRange(deck, { included: true, whole: false, from: 90, to: 500 }),
    ).toBe(7);
    expect(
      unitsInRange(deck, { included: true, whole: false, from: 200, to: 300 }),
    ).toBe(0);
  });

  it("scales by the share of the file that had readable text", () => {
    // 50 readable pages across a 100-page span: half a range is readable too.
    const sparse: SourceOption = { ...deck, units: 50, lastIndex: 100 };
    expect(
      unitsInRange(sparse, { included: true, whole: false, from: 1, to: 20 }),
    ).toBe(10);
  });

  it("counts nothing for a file that was switched off", () => {
    expect(
      unitsInRange(deck, { included: false, whole: true, from: 1, to: 96 }),
    ).toBe(0);
  });
});

describe("selectedUnits", () => {
  it("adds up the files that are in, and skips the ones that are out", () => {
    const notes: SourceOption = {
      id: "file-2",
      filename: "notes.pdf",
      fileType: "pdf",
      units: 20,
      firstIndex: 1,
      lastIndex: 20,
    };

    expect(
      selectedUnits([deck, notes], {
        [deck.id]: { included: true, whole: false, from: 1, to: 10 },
        [notes.id]: { included: false, whole: true, from: 1, to: 20 },
      }),
    ).toBe(10);
  });
});

describe("isDensityMode", () => {
  it("rejects anything that did not come from the control", () => {
    expect(isDensityMode("standard")).toBe(true);
    expect(isDensityMode("EXHAUSTIVE")).toBe(false);
    expect(isDensityMode(undefined)).toBe(false);
  });
});

describe("blendYield", () => {
  it("ignores missing or too-small history", () => {
    expect(blendYield(0.7)).toBe(0.7);
    expect(blendYield(0.7, { cards: 50, units: 19 })).toBe(0.7);
  });

  it("gives history half the weight at 100 units, more as it grows", () => {
    expect(blendYield(0.5, { cards: 150, units: 100 })).toBeCloseTo(1);
    const heavy = blendYield(0.5, { cards: 900, units: 600 });
    expect(heavy).toBeGreaterThan(1.3);
    expect(heavy).toBeLessThan(1.5);
  });
});

describe("high density", () => {
  it("is only a custom ratio above the basic ceiling", () => {
    expect(isHighDensity("custom", MAX_RATIO)).toBe(false);
    expect(isHighDensity("custom", MAX_RATIO + 0.1)).toBe(true);
    expect(isHighDensity("custom", null)).toBe(false);
    expect(isHighDensity("exhaustive", 30)).toBe(false);
  });

  it("clamps to whichever ceiling the server allows", () => {
    expect(ratioFor("custom", 30)).toBe(MAX_RATIO);
    expect(ratioFor("custom", 30, ADMIN_MAX_RATIO)).toBe(30);
    expect(ratioFor("custom", 500, ADMIN_MAX_RATIO)).toBe(ADMIN_MAX_RATIO);
  });

  it("cuts batches so one reply never asks for more than it can hold", () => {
    expect(batchSizeFor(30, 8)).toBe(1);
    expect(batchSizeFor(10, 8)).toBe(4);
    expect(batchSizeFor(5, 8)).toBe(8);
    expect(batchSizeFor(1, 8)).toBe(8);
    expect(batchSizeFor(ADMIN_MAX_RATIO, 8) * ADMIN_MAX_RATIO).toBeLessThanOrEqual(
      MAX_CARDS_PER_BATCH,
    );
  });
});
