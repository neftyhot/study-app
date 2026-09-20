import { describe, expect, it } from "vitest";

import { buildIdf, rank, relevance, similarity, terms } from "./candidates";

describe("terms", () => {
  it("drops question words and instruction verbs", () => {
    expect(terms("Describe the role of aldosterone")).toEqual(["aldosterone"]);
  });

  it("folds plurals so they match their singular", () => {
    expect(terms("hormones")).toEqual(terms("hormone"));
    expect(terms("arteries")).toEqual(terms("artery"));
  });
});

describe("relevance", () => {
  const corpus = [
    "aldosterone increases sodium reabsorption hormone",
    "adh increases water reabsorption hormone",
    "renin release hormone",
    "cortisol stress response hormone",
  ];
  const idf = buildIdf(corpus);

  it("weights a rare shared term above a common one", () => {
    // Both documents match exactly one of the query's two terms. The one that
    // matches the distinctive term has to win, or ranking is just word counting.
    const rare = relevance("aldosterone hormone", "aldosterone secretion", idf);
    const common = relevance("aldosterone hormone", "cortisol hormone", idf);
    expect(rare).toBeGreaterThan(common);
  });

  it("scores zero when nothing overlaps", () => {
    expect(relevance("glycolysis pyruvate", corpus[0], idf)).toBe(0);
  });

  it("ranks the document that shares the distinctive term first", () => {
    const ranked = rank(
      "What does aldosterone do to sodium?",
      corpus,
      (doc) => doc,
      idf,
      { limit: 2 },
    );
    expect(ranked[0]).toBe(corpus[0]);
  });

  it("drops documents below the score floor rather than padding the list", () => {
    const ranked = rank("glycolysis", corpus, (doc) => doc, idf, {
      minScore: 0,
    });
    expect(ranked).toEqual([]);
  });
});

describe("similarity", () => {
  it("is high for slides on the same subject and low across subjects", () => {
    const corpus = [
      "aldosterone acts on the distal tubule to reabsorb sodium",
      "aldosterone blocks sodium reabsorption at the distal tubule",
      "glycolysis converts glucose to pyruvate in the cytosol",
    ];
    const idf = buildIdf(corpus);

    expect(similarity(corpus[0], corpus[1], idf)).toBeGreaterThan(0.5);
    expect(similarity(corpus[0], corpus[2], idf)).toBeLessThan(0.1);
  });
});
