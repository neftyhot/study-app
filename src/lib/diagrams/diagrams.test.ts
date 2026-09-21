/**
 * Diagram drill tests.
 *
 * Two things matter here and nothing else does. A box means the same thing
 * wherever it is drawn or answered, because it is stored as a share of the
 * image rather than in pixels. And a drill is a card: it goes through the same
 * scheduler, so it cannot drift into being a second, unscheduled study system.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import {
  cardRubrics,
  courses,
  diagramOcclusions,
  exams,
  flashcards,
  sourceFiles,
  sourceSlides,
  type OcclusionMask,
} from "@/db/schema";

import {
  createDrill,
  deleteDrill,
  drillCountsBySlide,
  DrillError,
  listDrills,
  updateDrill,
} from "./index";
import {
  clampRect,
  gradeForDrill,
  isUsableRect,
  labelSummary,
  MIN_MASK_SIZE,
  readingOrder,
  rectFromDrag,
  validateMasks,
} from "./masks";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;
let examId: string;
let slideId: string;

function mask(overrides: Partial<OcclusionMask> = {}): OcclusionMask {
  return {
    id: crypto.randomUUID(),
    x: 10,
    y: 10,
    width: 20,
    height: 8,
    label: "Cornea",
    ...overrides,
  };
}

beforeEach(() => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });

  const course = db.insert(courses).values({ title: "A&P" }).returning().get();
  examId = db
    .insert(exams)
    .values({ courseId: course.id, title: "Exam 1" })
    .returning()
    .get().id;
  const fileId = db
    .insert(sourceFiles)
    .values({
      examId,
      filename: "eye.pdf",
      fileType: "pdf",
      role: "slides",
      rawPath: "eye.pdf",
      status: "ready",
    })
    .returning()
    .get().id;
  slideId = db
    .insert(sourceSlides)
    .values({ sourceFileId: fileId, index: 12, title: "The eye" })
    .returning()
    .get().id;
});

describe("geometry", () => {
  it("makes a rectangle from a drag in any direction", () => {
    const up = rectFromDrag({ x: 40, y: 50 }, { x: 10, y: 20 });
    expect(up).toEqual({ x: 10, y: 20, width: 30, height: 30 });
  });

  it("never lets a box leave the image", () => {
    const off = rectFromDrag({ x: 90, y: 90 }, { x: 140, y: 130 });
    expect(off.x + off.width).toBeLessThanOrEqual(100);
    expect(off.y + off.height).toBeLessThanOrEqual(100);

    expect(clampRect({ x: -20, y: -5, width: 10, height: 10 })).toMatchObject({
      x: 0,
      y: 0,
    });
  });

  it("refuses a box too small to click", () => {
    expect(isUsableRect({ x: 0, y: 0, width: MIN_MASK_SIZE, height: MIN_MASK_SIZE })).toBe(true);
    expect(isUsableRect({ x: 0, y: 0, width: 0, height: 0 })).toBe(false);
    expect(isUsableRect({ x: 0, y: 0, width: 30, height: 0.2 })).toBe(false);
  });
});

describe("readingOrder", () => {
  it("goes down the diagram, then across", () => {
    const topRight = mask({ x: 70, y: 5, label: "B" });
    const topLeft = mask({ x: 10, y: 6, label: "A" });
    const bottom = mask({ x: 40, y: 60, label: "C" });

    expect(readingOrder([bottom, topRight, topLeft]).map((m) => m.label)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("treats labels that only look level as level", () => {
    // Two labels three percent apart are the same row to a reader, and
    // jumping between rows would make keyboard navigation useless.
    const left = mask({ x: 10, y: 20, label: "left" });
    const right = mask({ x: 80, y: 22, label: "right" });

    expect(readingOrder([right, left]).map((m) => m.label)).toEqual([
      "left",
      "right",
    ]);
  });
});

describe("validateMasks", () => {
  it("says everything that is wrong at once", () => {
    const problems = validateMasks([
      mask({ label: "" }),
      mask({ width: 0.2, height: 0.2, label: "tiny" }),
    ]);

    expect(problems).toHaveLength(2);
    expect(problems.join(" ")).toMatch(/no label/);
    expect(problems.join(" ")).toMatch(/too small/);
  });

  it("rejects an empty drill", () => {
    expect(validateMasks([]).join(" ")).toMatch(/at least one box/);
  });

  it("accepts a labelled, clickable box", () => {
    expect(validateMasks([mask()])).toEqual([]);
  });
});

describe("gradeForDrill", () => {
  it("credits a perfect diagram as easy", () => {
    const masks = [mask({ label: "a" }), mask({ label: "b" })];
    const results = Object.fromEntries(masks.map((m) => [m.id, "recalled" as const]));

    expect(gradeForDrill(masks, results)).toMatchObject({ recalled: 2, grade: "easy" });
  });

  it("does not reset a diagram that was mostly right", () => {
    const masks = Array.from({ length: 10 }, (_, i) => mask({ label: `l${i}` }));
    const results = Object.fromEntries(
      masks.map((m, i) => [m.id, i === 0 ? ("missed" as const) : ("recalled" as const)]),
    );

    expect(gradeForDrill(masks, results).grade).toBe("difficult");
  });

  it("counts an unanswered box as missed, because skipping is not recalling", () => {
    const masks = [mask({ label: "a" }), mask({ label: "b" })];
    const outcome = gradeForDrill(masks, { [masks[0].id]: "recalled" });

    expect(outcome).toMatchObject({ recalled: 1, missed: 1, grade: "missed" });
  });
});

describe("createDrill", () => {
  it("creates a card, a rubric and the boxes together", () => {
    const { card, drill } = createDrill(db, {
      examId,
      sourceSlideId: slideId,
      imagePath: "rendered/exam/slide.png",
      masks: [mask({ label: "Cornea" }), mask({ y: 40, label: "Lens" })],
      topic: "The eye",
    });

    expect(card.question).toContain("2 hidden labels");
    expect(card.directAnswer).toBe("Cornea, Lens");
    expect(card.sourceSlideId).toBe(slideId);
    // A picture is not a quotation, so no excerpt is invented for it.
    expect(card.sourceExcerpt).toBeNull();
    // The student drew these, so regenerating the deck must not delete them.
    expect(card.isUserEdited).toBe(true);

    const rubric = db
      .select()
      .from(cardRubrics)
      .where(eq(cardRubrics.flashcardId, card.id))
      .get();
    expect(rubric?.essentialPoints).toEqual(["Cornea", "Lens"]);

    expect(drill.maskCoordinates).toHaveLength(2);
  });

  it("refuses to save a drill the student could not answer", () => {
    expect(() =>
      createDrill(db, {
        examId,
        sourceSlideId: slideId,
        imagePath: "x.png",
        masks: [mask({ label: "   " })],
      }),
    ).toThrow(DrillError);

    // Nothing is left behind by the attempt.
    expect(db.select().from(flashcards).all()).toHaveLength(0);
    expect(db.select().from(diagramOcclusions).all()).toHaveLength(0);
  });

  it("stores the boxes in the order the drill asks them", () => {
    const { drill } = createDrill(db, {
      examId,
      sourceSlideId: slideId,
      imagePath: "x.png",
      masks: [mask({ y: 70, label: "last" }), mask({ y: 5, label: "first" })],
    });

    expect(drill.maskCoordinates.map((m) => m.label)).toEqual(["first", "last"]);
  });
});

describe("updateDrill", () => {
  it("keeps the card's answer and rubric in step with the boxes", () => {
    const { card, drill } = createDrill(db, {
      examId,
      sourceSlideId: slideId,
      imagePath: "x.png",
      masks: [mask({ label: "Cornea" })],
    });

    updateDrill(db, drill.id, [
      mask({ label: "Cornea" }),
      mask({ y: 50, label: "Retina" }),
    ]);

    const updated = db
      .select()
      .from(flashcards)
      .where(eq(flashcards.id, card.id))
      .get();
    expect(updated?.directAnswer).toBe("Cornea, Retina");
    expect(updated?.updatedAt).not.toBeNull();

    const rubric = db
      .select()
      .from(cardRubrics)
      .where(eq(cardRubrics.flashcardId, card.id))
      .get();
    expect(rubric?.essentialPoints).toEqual(["Cornea", "Retina"]);
  });
});

describe("deleteDrill", () => {
  it("takes the card with it, since the drill is the card", () => {
    const { card, drill } = createDrill(db, {
      examId,
      sourceSlideId: slideId,
      imagePath: "x.png",
      masks: [mask()],
    });

    expect(deleteDrill(db, drill.id)).toBe(true);
    expect(
      db.select().from(flashcards).where(eq(flashcards.id, card.id)).get(),
    ).toBeUndefined();
    expect(db.select().from(diagramOcclusions).all()).toHaveLength(0);
  });
});

describe("listing", () => {
  it("counts the drills built from each page", () => {
    createDrill(db, { examId, sourceSlideId: slideId, imagePath: "x.png", masks: [mask()] });
    createDrill(db, { examId, sourceSlideId: slideId, imagePath: "x.png", masks: [mask()] });

    expect(drillCountsBySlide(db, examId)[slideId]).toBe(2);
    expect(listDrills(db, examId)).toHaveLength(2);
  });

  it("leaves out a drill whose card was excluded from study", () => {
    const { card } = createDrill(db, {
      examId,
      sourceSlideId: slideId,
      imagePath: "x.png",
      masks: [mask()],
    });
    db.update(flashcards).set({ excluded: true }).where(eq(flashcards.id, card.id)).run();

    expect(listDrills(db, examId)).toHaveLength(0);
  });
});

describe("labelSummary", () => {
  it("reads out the labels in the order they are asked", () => {
    expect(
      labelSummary([mask({ y: 60, label: "B" }), mask({ y: 10, label: "A" })]),
    ).toBe("A, B");
  });
});
