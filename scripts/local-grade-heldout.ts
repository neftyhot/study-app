/**
 * Held-out grading cases for scripts/local-grade-bench.ts.
 *
 * GRADING_FIXTURES is 12 cases on two hormones, and prompt changes tuned
 * against it would overfit. These cover eight other topics and the same
 * behaviours — paraphrase, abbreviation, typo, terse, reversed direction,
 * wrong site or cell, one point of several, "don't know", unrelated — and are
 * never shown to the model as examples.
 */
import type { GradingFixture } from "../src/lib/grade/fixtures";

const INSULIN = {
  question: "What does insulin do to blood glucose, and which cells release it?",
  expected: "It lowers blood glucose and is released by the beta cells of the pancreatic islets.",
  essentialPoints: ["lowers blood glucose", "beta cells of the pancreas"],
  misconceptions: ["It is released by alpha cells."],
};

const LIGHT = {
  question: "Where do the light-dependent reactions of photosynthesis occur, and what do they produce?",
  expected: "In the thylakoid membranes of the chloroplast; they produce ATP and NADPH (and release oxygen).",
  essentialPoints: ["thylakoid membrane", "produce ATP and NADPH"],
  misconceptions: ["They occur in the stroma."],
};

const SYMPATHETIC = {
  question: "What does sympathetic stimulation do to heart rate, and which receptor mediates it?",
  expected: "It increases heart rate, acting through beta-1 adrenergic receptors on the SA node.",
  essentialPoints: ["increases heart rate", "beta-1 adrenergic receptors"],
  misconceptions: ["It acts through muscarinic receptors."],
};

const OXPHOS = {
  question: "Where in the cell does oxidative phosphorylation take place?",
  expected: "On the inner mitochondrial membrane.",
  essentialPoints: ["inner mitochondrial membrane"],
  misconceptions: ["In the outer mitochondrial membrane.", "In the cytoplasm."],
};

const PTH = {
  question: "What does parathyroid hormone do to blood calcium, and how?",
  expected: "It raises blood calcium, largely by stimulating osteoclast bone resorption.",
  essentialPoints: ["increases blood calcium", "stimulates bone resorption by osteoclasts"],
  misconceptions: ["It lowers blood calcium, like calcitonin."],
};

const COMPETITIVE = {
  question: "How does a competitive inhibitor change Km and Vmax?",
  expected: "Km increases; Vmax is unchanged.",
  essentialPoints: ["Km increases", "Vmax unchanged"],
  misconceptions: ["It decreases Vmax."],
};

const SURFACTANT = {
  question: "Which cells produce pulmonary surfactant, and what does it do?",
  expected: "Type II pneumocytes; it lowers alveolar surface tension so alveoli don't collapse.",
  essentialPoints: ["type II pneumocytes", "reduces surface tension"],
  misconceptions: ["It is made by type I pneumocytes."],
};

const LIGASE = {
  question: "Which enzyme joins Okazaki fragments together?",
  expected: "DNA ligase.",
  essentialPoints: ["DNA ligase"],
  misconceptions: ["DNA polymerase.", "Helicase."],
};

const c = (
  base: Omit<GradingFixture, "name" | "answer" | "verdict" | "why">,
  name: string,
  answer: string,
  verdict: GradingFixture["verdict"],
): GradingFixture => ({ ...base, name, answer, verdict, why: "held out" });

export const HELDOUT_FIXTURES: GradingFixture[] = [
  c(INSULIN, "insulin: paraphrase", "it brings the sugar in your blood down, made by beta cells in the pancreas", "correct"),
  c(INSULIN, "insulin: symbols", "β cells (islets of Langerhans); decreases plasma glucose", "correct"),
  c(INSULIN, "insulin: reversed", "raises blood sugar, released from pancreatic beta cells", "incorrect"),
  c(INSULIN, "insulin: wrong cell", "lowers blood glucose; it's secreted by the alpha cells", "incorrect"),
  c(INSULIN, "insulin: one of two", "it lowers blood sugar", "partial"),

  c(LIGHT, "light: terse", "thylakoids; ATP + NADPH", "correct"),
  c(LIGHT, "light: typo", "in the thylakiod membrane, makes atp and nadph", "correct"),
  c(LIGHT, "light: wrong site", "in the stroma, making ATP and NADPH", "incorrect"),
  c(LIGHT, "light: one of two", "they make ATP and NADPH for the Calvin cycle", "partial"),
  c(LIGHT, "light: doesn't know", "not sure, something to do with chlorophyll", "incorrect"),

  c(SYMPATHETIC, "symp: paraphrase", "speeds the heart up via β1 receptors", "correct"),
  c(SYMPATHETIC, "symp: loose wording", "heart rate goes up because noradrenaline binds the beta one receptors", "correct"),
  c(SYMPATHETIC, "symp: reversed", "it slows the heart rate through beta-1 receptors", "incorrect"),
  c(SYMPATHETIC, "symp: wrong receptor", "increases heart rate by acting on muscarinic M2 receptors", "incorrect"),
  c(SYMPATHETIC, "symp: one of two", "the heart beats faster", "partial"),

  c(OXPHOS, "oxphos: correct", "inner membrane of the mitochondria", "correct"),
  c(OXPHOS, "oxphos: abbreviation", "IMM", "correct"),
  c(OXPHOS, "oxphos: wrong membrane", "the outer mitochondrial membrane", "incorrect"),
  c(OXPHOS, "oxphos: wrong compartment", "in the cytoplasm", "incorrect"),

  c(PTH, "pth: paraphrase", "raises Ca2+ by getting osteoclasts to break down bone", "correct"),
  c(PTH, "pth: reversed", "lowers blood calcium by stimulating bone resorption", "incorrect"),
  c(PTH, "pth: one of two", "it increases calcium in the blood", "partial"),
  c(PTH, "pth: unrelated", "it regulates metabolism and body temperature", "incorrect"),

  c(COMPETITIVE, "enzyme: correct", "Km goes up, Vmax stays the same", "correct"),
  c(COMPETITIVE, "enzyme: reversed", "Km decreases and Vmax is unchanged", "incorrect"),
  c(COMPETITIVE, "enzyme: misconception", "it increases Km and lowers Vmax", "incorrect"),
  c(COMPETITIVE, "enzyme: one of two", "it raises the Km", "partial"),

  c(SURFACTANT, "surfactant: paraphrase", "made by type 2 alveolar cells, lowers surface tension so the alveoli don't collapse", "correct"),
  c(SURFACTANT, "surfactant: wrong cell", "type I pneumocytes make it; it reduces surface tension", "incorrect"),
  c(SURFACTANT, "surfactant: reversed", "type II cells; it increases surface tension", "incorrect"),
  c(SURFACTANT, "surfactant: one of two", "stops alveoli collapsing by lowering surface tension", "partial"),

  c(LIGASE, "ligase: one word", "ligase", "correct"),
  c(LIGASE, "ligase: misconception", "DNA polymerase I", "incorrect"),
  c(LIGASE, "ligase: doesn't know", "idk", "incorrect"),
];
