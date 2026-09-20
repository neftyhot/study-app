/**
 * Grading regression fixtures (PRD §7).
 *
 * Known answer/verdict pairs covering the behaviour the PRD actually
 * specifies: generous about wording, unforgiving about direction and
 * mechanism. They run against the live grader via `npm run grade:check`
 * rather than in the unit suite, because they are a measurement of the model,
 * not of our code — the code paths they exercise are already covered by
 * `grade.test.ts` with stubs.
 */
import type { ErrorType, TypedVerdict } from "@/lib/learn/typed";

export type GradingFixture = {
  name: string;
  question: string;
  expected: string;
  essentialPoints: string[];
  misconceptions?: string[];
  answer: string;
  verdict: TypedVerdict;
  /** Only asserted when the fixture is about a specific gate. */
  errorType?: ErrorType;
  why: string;
};

const ADH = {
  question: "What effect does ADH have on the kidney?",
  expected:
    "It increases water reabsorption by the collecting duct, concentrating the urine.",
  essentialPoints: ["increases water reabsorption", "collecting duct"],
  misconceptions: ["It increases sodium reabsorption in the distal tubule."],
};

const ALDO = {
  question: "Where is aldosterone produced and what does it do to sodium?",
  expected:
    "It is produced in the zona glomerulosa of the adrenal cortex and increases sodium reabsorption.",
  essentialPoints: ["zona glomerulosa of the adrenal cortex", "increases sodium reabsorption"],
  misconceptions: ["It is produced in the adrenal medulla."],
};

export const GRADING_FIXTURES: GradingFixture[] = [
  {
    ...ADH,
    name: "paraphrase",
    answer: "the kidneys hold onto more water, in the collecting duct",
    verdict: "correct",
    why: "PRD §7's own example: different words, same meaning.",
  },
  {
    ...ADH,
    name: "abbreviation and alternative name",
    answer:
      "vasopressin makes the collecting duct reabsorb more water so urine gets concentrated",
    verdict: "correct",
    why: "Standard alternative name must be accepted.",
  },
  {
    ...ADH,
    name: "misspelling",
    answer: "increases water reabsorbtion in the colecting duct",
    verdict: "correct",
    why: "The intended terms are unambiguous.",
  },
  {
    ...ADH,
    name: "terse but complete",
    answer: "more water reabsorbed, collecting duct",
    verdict: "correct",
    why: "Brevity is not omission when both points are made.",
  },
  {
    ...ADH,
    name: "reversed direction",
    answer: "it decreases water reabsorption in the collecting duct",
    verdict: "incorrect",
    errorType: "directionality",
    why: "The site is right and the direction is backwards — the error PRD §7 says must fail.",
  },
  {
    ...ADH,
    name: "reversed direction with everything else right",
    answer:
      "ADH acts on V2 receptors in the collecting duct, inserting aquaporins, and decreases water reabsorption so urine is dilute",
    verdict: "incorrect",
    errorType: "directionality",
    why: "Surrounding detail must not buy back a reversed direction.",
  },
  {
    ...ADH,
    name: "wrong site",
    answer: "it increases water reabsorption in the proximal tubule",
    verdict: "incorrect",
    errorType: "mechanism",
    why: "Right direction, wrong site.",
  },
  {
    ...ADH,
    name: "one point of two",
    answer: "it makes the kidney reabsorb more water",
    verdict: "partial",
    why: "Direction right, site not stated.",
  },
  {
    ...ADH,
    name: "admits not knowing",
    answer: "no idea, something about the kidney",
    verdict: "incorrect",
    why: "An admission of ignorance is not partial credit.",
  },
  {
    ...ADH,
    name: "confidently unrelated",
    answer: "it stimulates the release of renin from juxtaglomerular cells",
    verdict: "incorrect",
    why: "Fluent, on-topic, and answers a different question.",
  },
  {
    ...ALDO,
    name: "synthesis site confused",
    answer:
      "it is made in the adrenal medulla and increases sodium reabsorption",
    verdict: "incorrect",
    errorType: "mechanism",
    why: "Cortex vs. medulla is the mechanism mix-up PRD §7 names.",
  },
  {
    ...ALDO,
    name: "both points, loose wording",
    answer:
      "the outer zone of the adrenal cortex, zona glomerulosa — it makes you keep sodium",
    verdict: "correct",
    why: "Informal phrasing, both required points present.",
  },
];
