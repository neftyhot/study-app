/**
 * How hard typed answers are marked.
 *
 * Two things never change with the setting: a reversed direction and a wrong
 * mechanism are always wrong. What moves is how much of the rubric an answer
 * must say, and how precisely it must say it.
 */
export const STRICTNESS_LEVELS = ["lenient", "standard", "strict"] as const;
export type Strictness = (typeof STRICTNESS_LEVELS)[number];

export const DEFAULT_STRICTNESS: Strictness = "standard";

export const STRICTNESS_LABELS: Record<Strictness, { label: string; blurb: string }> = {
  lenient: {
    label: "Lenient",
    blurb:
      "The gist is enough. Everyday wording earns the point, and getting most of the required points counts as correct.",
  },
  standard: {
    label: "Standard",
    blurb:
      "Every required point must be there, in any wording. Spelling does not matter.",
  },
  strict: {
    label: "Strict",
    blurb:
      "Exam conditions. Every required point, using the proper term, and a misspelling that could name something else does not count.",
  },
};

export function isStrictness(value: unknown): value is Strictness {
  return typeof value === "string" && (STRICTNESS_LEVELS as readonly string[]).includes(value);
}

/** Appended to the grading system prompt. Standard adds nothing. */
export function strictnessRules(strictness: Strictness): string {
  switch (strictness) {
    case "lenient":
      return `

STRICTNESS: LENIENT
- Credit a point when the student clearly has the idea, even in everyday
  words or with an imprecise term ("the gland under the brain" for pituitary).
- Do not withhold a point for missing qualifiers or detail around it.
- Directionality and mechanism errors are still incorrect.`;
    case "strict":
      return `

STRICTNESS: STRICT
- Credit a point only when it is stated with the correct technical term or an
  accepted synonym. A vague or everyday description does not earn it.
- A misspelling that could be read as a different structure, hormone, or
  process ("hypothalmus" is fine; "hypothalamic" for "hypophyseal" is not)
  does not earn the point.
- Qualifiers in the required point (which layer, which cell type, which
  direction) must all be present.`;
    default:
      return "";
  }
}
