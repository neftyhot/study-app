/**
 * Written wrong options for a practice paper.
 *
 * The complaint that started this: a paper offered the right answer twice in
 * different words, because two cards asked the same thing and one lent its
 * answer to the other. Written options replace borrowed ones, and the
 * borrowing that remains (no model) skips cards that ask the same thing.
 */
import { describe, expect, it, vi } from "vitest";

import type { LlmProvider, StructuredRequest } from "@/lib/llm";
import { buildMcq, sameFact, type McqCard } from "@/lib/learn/mcq";

import { acceptOptions, writeOptions } from "./options";

function card(id: string, question: string, directAnswer: string): McqCard {
  return { id, topic: "CVP", question, directAnswer, misconceptions: [] };
}

describe("accepting written options", () => {
  it("drops the right answer, repeats, blanks and giveaways", () => {
    expect(
      acceptOptions("Fixed expenses ÷ CM ratio", [
        "fixed expenses ÷ CM ratio.",
        "Fixed expenses ÷ unit CM",
        "",
        "Fixed expenses  ÷ unit CM",
        "None of the above",
        "Sales − variable expenses",
        "CM ratio ÷ fixed expenses",
      ]),
    ).toEqual([
      "Fixed expenses ÷ unit CM",
      "Sales − variable expenses",
      "CM ratio ÷ fixed expenses",
    ]);
  });

  it("drops an option long enough to rule out by its length", () => {
    expect(acceptOptions("$65,000", ["$75,000", "x".repeat(60)])).toEqual(["$75,000"]);
  });
});

describe("writing options", () => {
  const stub = (questions: { token: string; wrong: string[] }[]) => {
    const requests: StructuredRequest[] = [];
    const provider: LlmProvider = {
      name: "stub",
      model: "stub",
      generateStructured: vi.fn(async (request: StructuredRequest) => {
        requests.push(request);
        return { data: { questions } as never };
      }),
    };
    return { provider, requests };
  };

  it("keeps a question's options only when enough survive", async () => {
    const { provider, requests } = stub([
      { token: "Q1", wrong: ["$75,000", "$90,000", "$35,000"] },
      { token: "Q2", wrong: ["Increase", "increase"] },
    ]);

    const written = await writeOptions(provider, [
      { id: "a", question: "Unit CM?", answer: "$65,000", misconceptions: [] },
      { id: "b", question: "Fixed costs?", answer: "Stay the same", misconceptions: ["Increase"] },
    ]);

    expect(written.get("a")).toEqual(["$75,000", "$90,000", "$35,000"]);
    expect(written.has("b")).toBe(false);
    expect(requests[0].feature).toBe("exam_options");
    expect(requests[0].prompt).toContain("Correct answer: $65,000");
    expect(requests[0].prompt).toContain("Known mistakes: Increase");
  });
});

describe("building options", () => {
  const breakEven = card(
    "a",
    "What formula gives break-even revenue in dollar sales?",
    "Fixed expenses divided by the contribution margin ratio",
  );
  const sameAgain = card(
    "b",
    "Which formula gives the break-even point in dollar sales?",
    "Total fixed expenses divided by the CM ratio",
  );
  const others = [
    card("c", "What happens to total fixed costs as activity changes?", "They stay the same in total"),
    card("d", "How is overhead applied to work in process?", "Predetermined rate times actual activity"),
    card("e", "What is the relevant range?", "The span of activity where cost behaviour holds"),
  ];

  it("uses the written options instead of the deck's", () => {
    const options = buildMcq(breakEven, [breakEven, sameAgain, ...others], {
      seed: 1,
      written: ["Fixed expenses divided by unit CM", "Sales minus variable expenses", "Variable expenses divided by sales"],
    });

    expect(options).toHaveLength(4);
    expect(options.filter((option) => option.correct)).toHaveLength(1);
    expect(options.map((option) => option.text)).not.toContain(sameAgain.directAnswer);
  });

  it("never borrows the answer of a card that asks the same thing", () => {
    expect(sameFact(breakEven, sameAgain)).toBe(true);

    for (let seed = 0; seed < 10; seed += 1) {
      const texts = buildMcq(breakEven, [breakEven, sameAgain, ...others], { seed }).map(
        (option) => option.text,
      );
      expect(texts).not.toContain(sameAgain.directAnswer);
    }
  });

  it("still lets members of one family compete", () => {
    expect(
      sameFact(
        card("x", "Which enzyme extends the leading strand?", "DNA polymerase III"),
        card("y", "Which enzyme removes RNA primers?", "DNA polymerase I"),
      ),
    ).toBe(false);
  });
});
