/**
 * Typed-answer grading boundary.
 *
 * Learn mode's recall rungs need a verdict on free text. Real semantic
 * grading — synonyms, abbreviations, directionality gates, multi-point
 * rubrics — is Phase 6 (PRD §7), so this defines the contract that phase
 * implements and ships a conservative stand-in behind it. Nothing in the
 * ladder or the UI knows which grader it is talking to.
 */
export type TypedVerdict = "correct" | "partial" | "incorrect";

export type TypedGrade = {
  verdict: TypedVerdict;
  /** Rubric points the answer hit, for granular error accounting (PRD §6). */
  metPoints: string[];
  missedPoints: string[];
  feedback: string;
};

export type TypedRequest = {
  question: string;
  expected: string;
  essentialPoints: string[];
  answer: string;
};

export interface TypedAnswerGrader {
  readonly name: string;
  grade(request: TypedRequest): Promise<TypedGrade>;
}

const FILLER = new Set(
  `a an and are as at be by for from in into is it its of on or that the their
   this to was were with`
    .split(/\s+/)
    .filter(Boolean),
);

function terms(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2 && !FILLER.has(term));
}

/**
 * Stand-in grader: does the answer contain most of each required point?
 *
 * Deliberately lenient about wording and strict about nothing else. It cannot
 * catch a directionality error ("decreases" where "increases" was required),
 * which is exactly why PRD §7 exists and why this is temporary. It is marked
 * as provisional so the UI can say so rather than imply a judgement it did not
 * make.
 */
export function createKeywordGrader(threshold = 0.6): TypedAnswerGrader {
  return {
    name: "keyword (provisional)",
    async grade({ expected, essentialPoints, answer }) {
      const given = new Set(terms(answer));

      if (given.size === 0) {
        return {
          verdict: "incorrect",
          metPoints: [],
          missedPoints: essentialPoints,
          feedback: "No answer given.",
        };
      }

      const points = essentialPoints.length > 0 ? essentialPoints : [expected];
      const metPoints: string[] = [];
      const missedPoints: string[] = [];

      for (const point of points) {
        const required = terms(point);
        if (required.length === 0) continue;
        const hits = required.filter((term) => given.has(term)).length;
        if (hits / required.length >= threshold) metPoints.push(point);
        else missedPoints.push(point);
      }

      const verdict: TypedVerdict =
        missedPoints.length === 0
          ? "correct"
          : metPoints.length > 0
            ? "partial"
            : "incorrect";

      return {
        verdict,
        metPoints,
        missedPoints,
        feedback:
          missedPoints.length === 0
            ? "Every required point is there."
            : `Missing: ${missedPoints.join("; ")}`,
      };
    },
  };
}
