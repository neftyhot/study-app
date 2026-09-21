import { describe, expect, it } from "vitest";

import type { SourceSlide, StudyGuideObjective } from "@/db/schema";

import { routeObjectives } from "./routing";

const slide = (index: number, rawText: string): SourceSlide => ({
  id: `s${index}`,
  sourceFileId: "f",
  index,
  title: null,
  rawText,
  speakerNotes: null,
  tables: [],
  imagePath: null,
  hasDiagram: false,
  legibilityFlag: "ok",
  createdAt: "",
});

const objective = (id: string, promptText: string) =>
  ({ id, promptText, label: null }) as StudyGuideObjective;

describe("routeObjectives", () => {
  const batches = [
    [slide(1, "Taste buds: gustatory cells, sweet salty bitter umami sour")],
    [slide(2, "Cochlea, organ of Corti, hair cells and deafness")],
    [slide(3, "Thyroid hormone, hyperthyroidism, goiter")],
    [slide(4, "Olfactory receptor cells and the olfactory bulb")],
  ];

  it("sends an objective to the pages that discuss it, not to all of them", () => {
    const routed = routeObjectives(
      batches,
      [objective("taste", "Where on the tongue are umami and sour tasted?")],
      { minBatches: 1 },
    );
    expect(routed.map((list) => list.length)).toEqual([1, 0, 0, 0]);
  });

  it("never routes an objective nowhere, even with no shared words", () => {
    const routed = routeObjectives(batches, [objective("odd", "Zzyzx quux")], {
      minBatches: 2,
    });
    expect(routed.flat()).toHaveLength(2);
  });
});
