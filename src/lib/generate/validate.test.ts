import { describe, expect, it } from "vitest";

import type { SourceSlide } from "@/db/schema";

import type { GeneratedCard } from "./schemas";
import { excerptAppearsIn, normalizeForMatch, validateCards } from "./validate";

function slide(index: number, overrides: Partial<SourceSlide> = {}): SourceSlide {
  return {
    id: `slide-${index}`,
    sourceFileId: "file-1",
    index,
    title: `Slide ${index} Title`,
    rawText: `ADH is produced in the hypothalamus and released from the posterior pituitary.`,
    speakerNotes: null,
    tables: [],
    imagePath: null,
    hasDiagram: false,
    legibilityFlag: "ok",
    createdAt: "2026-09-20",
    ...overrides,
  };
}

function card(overrides: Partial<GeneratedCard> = {}): GeneratedCard {
  return {
    topic: "ADH",
    facet: "origin",
    cardType: "atomic",
    question: "Where is ADH produced?",
    directAnswer: "The hypothalamus.",
    hasAiSupplement: false,
    slideCitation: "S1",
    sourceExcerpt: "ADH is produced in the hypothalamus",
    essentialPoints: ["hypothalamus"],
    ...overrides,
  };
}

describe("excerptAppearsIn", () => {
  it("matches across whitespace and quote-style differences", () => {
    const s = slide(1, { rawText: 'The  "tight"  junction\nseals the barrier.' });

    expect(excerptAppearsIn('the “tight” junction seals', s)).toBe(true);
  });

  it("searches speaker notes and table cells, not just body text", () => {
    const withNotes = slide(1, {
      rawText: "",
      speakerNotes: "Aldosterone drives sodium retention.",
    });
    const withTable = slide(2, {
      rawText: "",
      tables: [{ rows: [["Hormone", "Action"], ["ADH", "Water reabsorption"]] }],
    });

    expect(excerptAppearsIn("aldosterone drives sodium retention", withNotes)).toBe(
      true,
    );
    expect(excerptAppearsIn("Water reabsorption", withTable)).toBe(true);
  });

  it("accepts a quote truncated with ellipses, a common model formatting", () => {
    const s = slide(1, {
      rawText:
        "Release is triggered by increased plasma osmolarity detected by hypothalamic osmoreceptors, and by a fall in blood volume greater than 10%.",
    });

    // Leading, trailing, and interior ellipses all mark truncation, not content.
    expect(excerptAppearsIn("Release is triggered by...", s)).toBe(true);
    expect(excerptAppearsIn("...a fall in blood volume greater than 10%.", s)).toBe(
      true,
    );
    expect(
      excerptAppearsIn("Release is triggered by...blood volume greater than 10%", s),
    ).toBe(true);
    expect(excerptAppearsIn("Release is triggered by\u2026", s)).toBe(true);
  });

  it("still rejects a fabricated fragment inside an ellipsed quote", () => {
    const s = slide(1, {
      rawText: "Release is triggered by increased plasma osmolarity.",
    });

    expect(
      excerptAppearsIn("Release is triggered by...decreased plasma glucose", s),
    ).toBe(false);
  });

  it("requires ellipsed fragments to appear in order, not merely to be present", () => {
    const s = slide(1, {
      rawText: "Aldosterone increases sodium reabsorption and potassium excretion.",
    });

    expect(
      excerptAppearsIn("increases sodium reabsorption...potassium excretion", s),
    ).toBe(true);
    // Same fragments, reversed: stitching scattered words must not pass.
    expect(
      excerptAppearsIn("potassium excretion...increases sodium reabsorption", s),
    ).toBe(false);
  });

  it("rejects an excerpt that is only ellipses", () => {
    expect(excerptAppearsIn("...", slide(1))).toBe(false);
  });

  it("rejects text that is not in the slide", () => {
    expect(excerptAppearsIn("ADH is produced in the adrenal cortex", slide(1))).toBe(
      false,
    );
  });

  it("rejects an empty excerpt", () => {
    expect(excerptAppearsIn("   ", slide(1))).toBe(false);
  });
});

describe("validateCards", () => {
  const slides = [slide(1), slide(2, { rawText: "Aldosterone targets the distal tubule." })];

  it("accepts a card whose excerpt is really on the cited slide", () => {
    const { accepted, rejected } = validateCards([card()], slides);

    expect(rejected).toHaveLength(0);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].slide.id).toBe("slide-1");
    expect(accepted[0].repairedFrom).toBeUndefined();
  });

  it("drops a fabricated excerpt instead of storing it", () => {
    const { accepted, rejected } = validateCards(
      [card({ sourceExcerpt: "ADH is synthesized by the pancreas" })],
      slides,
    );

    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toBe("excerpt_not_in_source");
  });

  it("drops a card citing a slide that is not in the batch", () => {
    const { accepted, rejected } = validateCards(
      [card({ slideCitation: "S99" })],
      slides,
    );

    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toBe("unknown_citation");
    expect(rejected[0].detail).toContain("S99");
  });

  it("resolves a multi-slide or decorated citation via any token that matches", () => {
    const multi = validateCards(
      [card({ slideCitation: "S1, S2" })],
      slides,
    );
    expect(multi.rejected).toHaveLength(0);
    expect(multi.accepted[0].slide.id).toBe("slide-1");

    const decorated = validateCards([card({ slideCitation: "[S1]" })], slides);
    expect(decorated.rejected).toHaveLength(0);
    expect(decorated.accepted[0].slide.id).toBe("slide-1");
  });

  it("still rejects a citation whose tokens match no slide in the batch", () => {
    const { accepted, rejected } = validateCards(
      [card({ slideCitation: "S41, S42" })],
      slides,
    );

    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toBe("unknown_citation");
  });

  it("repairs a miscited card when the excerpt is on another slide", () => {
    const { accepted, rejected } = validateCards(
      [
        card({
          question: "What does aldosterone target?",
          slideCitation: "S1",
          sourceExcerpt: "Aldosterone targets the distal tubule",
        }),
      ],
      slides,
    );

    expect(rejected).toHaveLength(0);
    expect(accepted[0].slide.id).toBe("slide-2");
    expect(accepted[0].repairedFrom).toBe("S1");
  });

  it("rejects empty questions or answers", () => {
    const { rejected } = validateCards(
      [card({ question: "   " }), card({ directAnswer: "" })],
      slides,
    );

    expect(rejected).toHaveLength(2);
    expect(rejected.every((r) => r.reason === "empty_content")).toBe(true);
  });

  it("deduplicates within a batch and against existing cards", () => {
    const withinBatch = validateCards([card(), card()], slides);
    expect(withinBatch.accepted).toHaveLength(1);
    expect(withinBatch.rejected[0].reason).toBe("duplicate");

    const againstExisting = validateCards([card()], slides, {
      existingQuestions: ["where is ADH produced?"],
    });
    expect(againstExisting.accepted).toHaveLength(0);
    expect(againstExisting.rejected[0].reason).toBe("duplicate");
  });

  it("rejects a near-rephrase only when a similarity threshold is set", () => {
    const cards = [
      card({ question: "Which hormone released from the posterior pituitary controls water retention?" }),
      card({ question: "Which hormone released by the posterior pituitary controls water retention?" }),
    ];
    expect(validateCards(cards, slides).accepted).toHaveLength(2);

    const strict = validateCards(cards, slides, { similarity: 0.75 });
    expect(strict.accepted).toHaveLength(1);
    expect(strict.rejected[0].reason).toBe("duplicate");

    const againstExisting = validateCards([cards[1]], slides, {
      existingQuestions: [cards[0].question],
      similarity: 0.75,
    });
    expect(againstExisting.accepted).toHaveLength(0);
  });

  it("never calls short questions near-duplicates", () => {
    const { accepted } = validateCards(
      [
        card({ facet: "origin", question: "Where is ADH produced?" }),
        card({ facet: "target", question: "Where is ADH released?" }),
      ],
      slides,
      { similarity: 0.75 },
    );
    expect(accepted).toHaveLength(2);
  });

  it("treats distinct facets of one concept as distinct cards", () => {
    const { accepted } = validateCards(
      [
        card({ facet: "origin", question: "Where is ADH produced?" }),
        card({
          facet: "trigger",
          question: "What triggers ADH release?",
          sourceExcerpt: "released from the posterior pituitary",
        }),
      ],
      slides,
    );

    expect(accepted).toHaveLength(2);
  });
});

describe("normalizeForMatch", () => {
  it("collapses whitespace and case but preserves words", () => {
    expect(normalizeForMatch("  The   KIDNEY\n retains water ")).toBe(
      "the kidney retains water",
    );
  });
});

describe("excerptAppearsIn — layout is not content", () => {
  // Real slide text from a reproductive-physiology deck, bullets and all.
  const uterus = slide(8, {
    rawText:
      "• Perimetrium—external serosa layer\n• Myometrium—middle muscular layer\n– Constitutes most of the uterine wall\n• Endometrium—inner mucosa",
  });
  const senses = slide(12, {
    rawText: "– Special senses: limited to head\n• Vision, hearing, equilibrium, taste, and smell",
  });

  it("accepts a quote that drops the bullet markers", () => {
    expect(
      excerptAppearsIn("Special senses: limited to head Vision, hearing, equilibrium, taste, and smell", senses),
    ).toBe(true);
  });

  it("accepts lines quoted in order with a sub-bullet skipped", () => {
    expect(
      excerptAppearsIn(
        "Perimetrium—external serosa layer\nMyometrium—middle muscular layer\nEndometrium—inner mucosa",
        uterus,
      ),
    ).toBe(true);
  });

  it("still rejects a line the slide does not contain", () => {
    expect(
      excerptAppearsIn("Perimetrium—external serosa layer\nMyometrium—the layer that secretes estrogen", uterus),
    ).toBe(false);
  });

  it("accepts two lines joined with a spaced dash", () => {
    const ear = slide(55, {
      rawText: "• Membranous labyrinth—fleshy tubes lining bony\nlabyrinth\n– Filled with endolymph",
    });
    expect(
      excerptAppearsIn("Membranous labyrinth—fleshy tubes lining bony labyrinth – Filled with endolymph", ear),
    ).toBe(true);
  });

  it("still rejects lines quoted out of order", () => {
    expect(
      excerptAppearsIn("Endometrium—inner mucosa\nPerimetrium—external serosa layer", uterus),
    ).toBe(false);
  });
});
