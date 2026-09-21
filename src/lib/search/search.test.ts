/**
 * Search matching.
 *
 * The rule that matters most: what someone literally typed outranks anything
 * cleverer. A search that reorders an exact hit beneath a guess stops being
 * trusted, and an untrusted search is not used.
 */
import { describe, expect, it } from "vitest";

import { applyFilters, type SearchDoc } from "./docs";
import {
  exactIndex,
  highlight,
  isQuoted,
  search,
  shouldOfferSemantic,
  snippet,
  unquote,
} from "./match";
import { candidatesFor } from "./semantic";

type Item = { id: string; haystack: string };

const deck: Item[] = [
  { id: "ureter", haystack: "Ureter — carries urine from the kidney to the bladder" },
  { id: "urethra", haystack: "Urethra — carries urine from the bladder out of the body" },
  { id: "adh", haystack: "ADH increases water reabsorption in the collecting duct" },
  { id: "aldo", haystack: "Aldosterone increases sodium reabsorption in the distal tubule" },
  { id: "cornea", haystack: "The cornea refracts light entering the eye" },
];

describe("exact matching", () => {
  it("finds a literal phrase", () => {
    expect(exactIndex("The cornea refracts light", "cornea refracts")).toBe(4);
    expect(exactIndex("The cornea refracts light", "retina")).toBe(-1);
  });

  it("ignores case, curly quotes and runs of whitespace", () => {
    expect(exactIndex("It’s the  CORNEA", "it's the cornea")).toBe(0);
  });

  it("puts exact hits above everything lexical", () => {
    const results = search(deck, "carries urine");

    expect(results[0].kind).toBe("exact");
    expect(results[1].kind).toBe("exact");
    expect(results.map((r) => r.item.id).slice(0, 2).sort()).toEqual([
      "ureter",
      "urethra",
    ]);
  });

  it("returns nothing for an empty query rather than everything", () => {
    expect(search(deck, "   ")).toEqual([]);
  });
});

describe("quoted queries", () => {
  it("recognises and strips quotes", () => {
    expect(isQuoted('"collecting duct"')).toBe(true);
    expect(isQuoted("collecting duct")).toBe(false);
    expect(unquote('"collecting duct"')).toBe("collecting duct");
  });

  it("returns only literal matches, never a guess", () => {
    const results = search(deck, '"collecting duct"');

    expect(results).toHaveLength(1);
    expect(results[0].item.id).toBe("adh");
    expect(results.every((r) => r.kind === "exact")).toBe(true);
  });

  it("finds nothing rather than something close", () => {
    // Someone who typed quotes told us they know what they want.
    expect(search(deck, '"collecting ducts"')).toEqual([]);
  });
});

describe("lexical matching", () => {
  it("finds a card whose words are all present but not adjacent", () => {
    const results = search(deck, "reabsorption sodium");
    expect(results[0].item.id).toBe("aldo");
  });

  it("weights the distinctive word over the common one", () => {
    const results = search(deck, "aldosterone reabsorption");
    expect(results[0].item.id).toBe("aldo");
  });

  it("drops weak matches rather than padding the list", () => {
    const results = search(deck, "photosynthesis chloroplast");
    expect(results).toEqual([]);
  });
});

describe("when to ask the model", () => {
  it("offers it for a vague query that found little", () => {
    expect(shouldOfferSemantic("the tube that carries pee out", 0)).toBe(true);
    expect(shouldOfferSemantic("what happens when sodium rises", 2)).toBe(true);
  });

  it("does not offer it when local search already answered", () => {
    expect(shouldOfferSemantic("reabsorption", 30)).toBe(false);
  });

  it("never offers it for a quoted phrase", () => {
    // Quotes mean "this exactly"; widening the search would defy that.
    expect(shouldOfferSemantic('"collecting duct"', 0)).toBe(false);
  });
});

describe("presentation", () => {
  it("marks the matched span for highlighting", () => {
    const parts = highlight("The cornea refracts light", "cornea");

    expect(parts.map((p) => p.text).join("")).toBe("The cornea refracts light");
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["cornea"]);
  });

  it("leaves text alone when there is no match", () => {
    expect(highlight("Nothing here", "retina")).toEqual([
      { text: "Nothing here", hit: false },
    ]);
  });

  it("centres the snippet on the match", () => {
    const long = `${"filler ".repeat(40)}the cornea refracts light${" more".repeat(40)}`;
    const result = snippet(long, "cornea", 80);

    expect(result).toContain("cornea");
    expect(result.length).toBeLessThan(100);
    expect(result.startsWith("…")).toBe(true);
  });
});

describe("semantic candidates", () => {
  const items = deck.map((item) => ({ id: item.id, text: item.haystack }));

  it("shortlists by relevance", () => {
    const shortlist = candidatesFor("urine bladder", items, 2);
    expect(shortlist.map((item) => item.id).sort()).toEqual(["ureter", "urethra"]);
  });

  it("still offers candidates when the query shares no words", () => {
    // A query sharing no vocabulary is exactly the case the model is for.
    expect(candidatesFor("zzz qqq", items, 3)).toHaveLength(3);
  });
});

describe("filters", () => {
  const doc = (overrides: Partial<SearchDoc>): SearchDoc => ({
    id: crypto.randomUUID(),
    kind: "card",
    haystack: "text",
    title: "t",
    body: "b",
    courseId: "course-1",
    courseTitle: "Physiology",
    examId: "exam-1",
    examTitle: "Exam 1",
    topic: null,
    cardType: "atomic",
    starred: false,
    state: "unstudied",
    href: "/",
    ...overrides,
  });

  it("scopes to a subject or a deck", () => {
    const docs = [doc({}), doc({ courseId: "course-2", examId: "exam-2" })];

    expect(applyFilters(docs, { courseId: "course-1" })).toHaveLength(1);
    expect(applyFilters(docs, { examId: "exam-2" })).toHaveLength(1);
  });

  it("scopes by kind, card type and star", () => {
    const docs = [
      doc({}),
      doc({ kind: "source", cardType: null }),
      doc({ cardType: "application" }),
      doc({ starred: true }),
    ];

    expect(applyFilters(docs, { kinds: ["source"] })).toHaveLength(1);
    expect(applyFilters(docs, { cardType: "application" })).toHaveLength(1);
    expect(applyFilters(docs, { starred: true })).toHaveLength(1);
  });

  it("scopes by how well the card is known", () => {
    const docs = [
      doc({ state: "unstudied" }),
      doc({ state: "recognition" }),
      doc({ state: "retained" }),
      doc({ kind: "objective", state: null }),
    ];

    expect(applyFilters(docs, { progress: "unstudied" })).toHaveLength(1);
    expect(applyFilters(docs, { progress: "learning" })).toHaveLength(1);
    expect(applyFilters(docs, { progress: "retained" })).toHaveLength(1);
  });
});
