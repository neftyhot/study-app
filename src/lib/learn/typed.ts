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

/**
 * Why an answer failed. Directionality and mechanism are the two that PRD §7
 * makes non-negotiable: they are the errors that look like knowledge and are
 * not, and an answer carrying one is wrong however much else it gets right.
 */
export const ERROR_TYPES = [
  "none",
  "directionality",
  "mechanism",
  "incomplete",
  "unrelated",
] as const;

export type ErrorType = (typeof ERROR_TYPES)[number];

export type TypedGrade = {
  verdict: TypedVerdict;
  /** Rubric points the answer hit, for granular error accounting (PRD §6). */
  metPoints: string[];
  missedPoints: string[];
  /** Peripheral points the answer volunteered: credited, never required. */
  creditedOptional: string[];
  errorType: ErrorType;
  feedback: string;
  /** True when a stand-in grader produced this, so the UI can say so. */
  provisional: boolean;
};

export type TypedRequest = {
  question: string;
  expected: string;
  essentialPoints: string[];
  optionalPoints?: string[];
  /** Known wrong answers for this card; the best directionality detector we have. */
  misconceptions?: string[];
  answer: string;
  /** Drilling only the points a previous answer missed (PRD §7). */
  focusPoints?: string[];
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
    async grade({ expected, essentialPoints, focusPoints, answer }) {
      const given = new Set(terms(answer));

      if (given.size === 0) {
        return {
          verdict: "incorrect",
          metPoints: [],
          missedPoints: essentialPoints,
          creditedOptional: [],
          errorType: "unrelated",
          feedback: "No answer given.",
          provisional: true,
        };
      }

      const points =
        focusPoints && focusPoints.length > 0
          ? focusPoints
          : essentialPoints.length > 0
            ? essentialPoints
            : [expected];
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
        creditedOptional: [],
        errorType: missedPoints.length === 0 ? "none" : "incomplete",
        feedback:
          missedPoints.length === 0
            ? "Every required point is there."
            : `Missing: ${missedPoints.join("; ")}`,
        provisional: true,
      };
    },
  };
}
