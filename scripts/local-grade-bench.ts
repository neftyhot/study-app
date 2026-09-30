/**
 * Local "Check Answer" grading benchmark — proof of concept.
 *
 *   npx tsx scripts/local-grade-bench.ts <model.gguf> [more.gguf ...]
 *
 * Grades every fixture in src/lib/grade/fixtures.ts with a 1–3B GGUF model
 * through node-llama-cpp (already an app dependency), and reports:
 *   - model load time (paid once per app launch, not per click)
 *   - time to first token and total time per grade
 *   - output length in tokens
 *   - verdict accuracy against the fixtures' expected verdicts
 *
 * Env:
 *   MODE=points    the model judges each required point (stated / missing /
 *                  contradicted) plus one line of feedback; the verdict is
 *                  decided in code, like reconcileGrade does (default)
 *   MODE=verdict   the model emits the verdict directly, ~50 tokens
 *   MODE=app       the app's full GRADING_SYSTEM + GRADE_SCHEMA, unchanged
 *   RUNS=3         passes over the fixture set (first pass includes a cold
 *                  system prompt; later passes show the warm steady state)
 *   GPU=false      force CPU-only, to approximate a laptop without Metal/CUDA
 *   THREADS=4      CPU threads when GPU=false
 *   SET=all        which cases: "orig" (GRADING_FIXTURES), "heldout"
 *                  (scripts/local-grade-heldout.ts), or "all" (default)
 *
 * Points-mode accuracy levers (each 0/1, all off by default):
 *   FEWSHOT=1      worked examples in the (cached) system prompt, on topics
 *                  that appear in neither case set
 *   TRAPS=1        one yes/no check per known misconception; "yes" fails
 *   EVIDENCE=1     the model quotes the words it relied on before marking
 *                  each point
 *   CODEFEEDBACK=1 no model-written feedback; it is built from the marks
 *   VERBOSE=1      print every case, not just the misses
 *
 * No API key is used. Nothing here touches the app's settings or database.
 */
import { performance } from "node:perf_hooks";
import path from "node:path";

import { GRADING_FIXTURES } from "../src/lib/grade/fixtures";
import { GRADE_SCHEMA } from "../src/lib/grade/schemas";
import { GRADING_SYSTEM, gradingPrompt, tokenizePoints } from "../src/lib/grade/prompts";
import { toGrammarSchema } from "../src/lib/llm/local";
import type { GradingFixture } from "../src/lib/grade/fixtures";

import { HELDOUT_FIXTURES } from "./local-grade-heldout";

const MODE = (process.env.MODE ?? "points") as "points" | "verdict" | "app";
const RUNS = Number(process.env.RUNS ?? 3);
const GPU = process.env.GPU !== "false";
const THREADS = process.env.THREADS ? Number(process.env.THREADS) : undefined;
const SET = process.env.SET ?? "all";
const flag = (name: string) => process.env[name] === "1";
const FEWSHOT = flag("FEWSHOT");
const TRAPS = flag("TRAPS");
const EVIDENCE = flag("EVIDENCE");
const CODEFEEDBACK = flag("CODEFEEDBACK");
const VERBOSE = flag("VERBOSE");

const CASES: (GradingFixture & { set: string })[] = [
  ...(SET === "heldout" ? [] : GRADING_FIXTURES.map((f) => ({ ...f, set: "orig" }))),
  ...(SET === "orig" ? [] : HELDOUT_FIXTURES.map((f) => ({ ...f, set: "heldout" }))),
];

/**
 * The short-verdict variant. Same gates as the app's grader (direction and
 * mechanism errors are never partial credit), written tighter: every token of
 * system prompt is prefill the student waits for on a cold cache.
 */
const VERDICT_SYSTEM = `You grade a student's answer against required points. Mark meaning, not wording.
Accept synonyms, paraphrase, abbreviations (ADH = vasopressin), typos, and short answers that make the point.
Never partial credit, always "incorrect":
- direction reversed (increase/decrease, stimulate/inhibit, retain/excrete): errorType "directionality"
- wrong site, cell, organ, or process (synthesis vs release, cortex vs medulla): errorType "mechanism"
Otherwise: "correct" if every required point is stated; "partial" if some are and none contradicted (errorType "incomplete"); "incorrect" if none are, or the student doesn't know (errorType "unrelated").
Only credit what the answer actually says.
feedback: under 15 words, to the student, naming what they missed or got wrong. If correct, just "Correct."`;

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["correct", "partial", "incorrect"] },
    errorType: {
      type: "string",
      enum: ["none", "directionality", "mechanism", "incomplete", "unrelated"],
    },
    feedback: { type: "string", maxLength: 120 },
  },
  required: ["verdict", "errorType", "feedback"],
} as const;

function verdictPrompt(fixture: (typeof GRADING_FIXTURES)[number]) {
  const points = fixture.essentialPoints.map((p, i) => `P${i + 1}. ${p}`).join("\n");
  const traps = fixture.misconceptions?.length
    ? `\nKnown wrong answers: ${fixture.misconceptions.join("; ")}`
    : "";
  return `Question: ${fixture.question}
Model answer: ${fixture.expected}
Required points:
${points}${traps}
Student's answer: ${fixture.answer}`;
}

/**
 * The per-point variant. A 3B model asked for a verdict up front commits to
 * one before it has looked at the answer (it said "incorrect" to 11 of 12
 * fixtures). Asked one narrow question per point, it does much better, and
 * the verdict rule — any contradiction fails, all stated passes, some stated
 * is partial — is applied in code, where it cannot be talked out of.
 */
const POINTS_RULES = `You check a student's answer against required points, one point at a time.
For each point answer exactly one of:
- "stated": the answer says it, in any words. Synonyms, paraphrase, abbreviations (ADH = vasopressin), symbols, typos, and very short answers all count.
- "missing": the answer does not mention it.
- "contradicted": the answer says the opposite direction (decreases instead of increases, inhibits instead of stimulates) or a different site, organ, cell, receptor, or process (proximal tubule instead of collecting duct, medulla instead of cortex).
Judge only what the student wrote.`;

const TRAP_RULES = `
For each trap T1, T2...: "yes" only if the student's answer itself makes that wrong claim, otherwise "no".`;

const EVIDENCE_RULES = `
For each point, first copy the few words of the answer that address it (or "" if none), then mark it.`;

const FEEDBACK_RULES = `
Then give feedback: under 15 words, spoken to the student, naming what they missed or got wrong. If every point is stated, feedback is "Correct."`;

type PointJudgement = "stated" | "missing" | "contradicted";

type Example = {
  question: string;
  points: string[];
  traps: string[];
  answer: string;
  marks: PointJudgement[];
  quotes: string[];
  trapHits: ("yes" | "no")[];
  feedback: string;
};

/** Topics in neither case set, so the examples teach the task, not the answers. */
const EXAMPLES: Example[] = [
  {
    question: "Where does glycolysis occur, and what is its net ATP yield?",
    points: ["cytoplasm", "net 2 ATP"],
    traps: ["It occurs in the mitochondria."],
    answer: "in the cytosol, you net two atp",
    marks: ["stated", "stated"],
    quotes: ["in the cytosol", "net two atp"],
    trapHits: ["no"],
    feedback: "Correct.",
  },
  {
    question: "What does glucagon do to blood glucose?",
    points: ["raises blood glucose"],
    traps: ["It lowers blood glucose."],
    answer: "it lowers blood sugar so it doesn't get too high",
    marks: ["contradicted"],
    quotes: ["lowers blood sugar"],
    trapHits: ["yes"],
    feedback: "Backwards: glucagon raises blood glucose.",
  },
  {
    question: "Which vessels carry oxygenated blood from the lungs to the heart, and into which chamber?",
    points: ["pulmonary veins", "left atrium"],
    traps: ["The pulmonary artery."],
    answer: "the pulmonary arteries, into the left atrium",
    marks: ["contradicted", "stated"],
    quotes: ["pulmonary arteries", "left atrium"],
    trapHits: ["yes"],
    feedback: "Wrong vessel: it's the pulmonary veins.",
  },
  {
    question: "What do thyroid hormones do to metabolic rate, and which gland makes them?",
    points: ["increase metabolic rate", "thyroid gland"],
    traps: ["They are made by the pituitary."],
    answer: "T3/T4 speed up metabolism",
    marks: ["stated", "missing"],
    quotes: ["speed up metabolism", ""],
    trapHits: ["no"],
    feedback: "Also say they are made by the thyroid gland.",
  },
  {
    question: "What neurotransmitter is released at the neuromuscular junction?",
    points: ["acetylcholine"],
    traps: ["Noradrenaline."],
    answer: "no idea",
    marks: ["missing"],
    quotes: [""],
    trapHits: ["no"],
    feedback: "It's acetylcholine.",
  },
];

function exampleOutput(example: Example) {
  const out: Record<string, unknown> = {};
  example.points.forEach((_, i) => {
    out[`P${i + 1}`] = EVIDENCE
      ? { quote: example.quotes[i], mark: example.marks[i] }
      : example.marks[i];
  });
  if (TRAPS) example.traps.forEach((_, i) => (out[`T${i + 1}`] = example.trapHits[i]));
  if (!CODEFEEDBACK) out.feedback = example.feedback;
  return JSON.stringify(out);
}

const POINTS_SYSTEM =
  POINTS_RULES +
  (TRAPS ? TRAP_RULES : "") +
  (EVIDENCE ? EVIDENCE_RULES : "") +
  (CODEFEEDBACK ? "" : FEEDBACK_RULES) +
  (FEWSHOT
    ? "\n\nExamples:\n\n" +
      EXAMPLES.map(
        (e) =>
          `${renderPoints(e.question, e.points, e.traps, e.answer)}\nOutput: ${exampleOutput(e)}`,
      ).join("\n\n")
    : "");

function pointsSchema(count: number, trapCount: number) {
  const properties: Record<string, unknown> = {};
  const mark = { type: "string", enum: ["stated", "missing", "contradicted"] };
  for (let i = 1; i <= count; i++) {
    properties[`P${i}`] = EVIDENCE
      ? {
          type: "object",
          properties: { quote: { type: "string", maxLength: 60 }, mark },
          required: ["quote", "mark"],
        }
      : mark;
  }
  if (TRAPS) {
    for (let i = 1; i <= trapCount; i++) {
      properties[`T${i}`] = { type: "string", enum: ["yes", "no"] };
    }
  }
  if (!CODEFEEDBACK) properties.feedback = { type: "string", maxLength: 120 };
  return { type: "object", properties, required: Object.keys(properties) };
}

function renderPoints(question: string, points: string[], traps: string[], answer: string) {
  const lines = points.map((p, i) => `P${i + 1}: ${p}`).join("\n");
  const trapLines =
    TRAPS && traps.length
      ? `\nTraps (known wrong answers):\n${traps.map((t, i) => `T${i + 1}: ${t}`).join("\n")}`
      : "";
  return `Question: ${question}\nRequired points:\n${lines}${trapLines}\nStudent's answer: "${answer}"`;
}

function pointsPrompt(fixture: GradingFixture) {
  return renderPoints(
    fixture.question,
    fixture.essentialPoints,
    fixture.misconceptions ?? [],
    fixture.answer,
  );
}

function markOf(value: unknown): PointJudgement {
  return (typeof value === "object" && value ? (value as { mark: string }).mark : value) as PointJudgement;
}

function decidePoints(parsed: Record<string, unknown>, fixture: GradingFixture) {
  const count = fixture.essentialPoints.length;
  const judgements: PointJudgement[] = [];
  for (let i = 1; i <= count; i++) judgements.push(markOf(parsed[`P${i}`]));
  const trapHit =
    TRAPS && (fixture.misconceptions ?? []).some((_, i) => parsed[`T${i + 1}`] === "yes");
  const stated = judgements.filter((j) => j === "stated").length;

  let verdict: string;
  if (judgements.includes("contradicted") || trapHit) verdict = "incorrect";
  else if (stated === count) verdict = "correct";
  else verdict = stated > 0 ? "partial" : "incorrect";

  // The feedback the app would show, built from the marks rather than
  // trusted to a 3B model's prose.
  let feedback: string;
  if (CODEFEEDBACK) {
    const wrong = fixture.essentialPoints.filter((_, i) => judgements[i] === "contradicted");
    const missed = fixture.essentialPoints.filter((_, i) => judgements[i] === "missing");
    if (verdict === "correct") feedback = "Correct.";
    else if (wrong.length) feedback = `Check this: ${wrong.join("; ")}.`;
    else if (trapHit) feedback = `That's a common mix-up. The answer: ${fixture.expected}`;
    else if (stated === 0) feedback = `The answer: ${fixture.expected}`;
    else feedback = `Also needed: ${missed.join("; ")}.`;
  } else {
    feedback = String(parsed.feedback ?? "");
  }
  return { verdict, feedback, marks: judgements.join(",") + (trapHit ? ",TRAP" : "") };
}

type Sample = {
  run: number;
  name: string;
  ttftMs: number;
  totalMs: number;
  outTokens: number;
  expected: string;
  got: string;
  ok: boolean;
  feedback: string;
  marks: string;
  set: string;
};

function pct(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const fmt = (ms: number) => `${Math.round(ms)} ms`;

async function benchModel(modelPath: string) {
  // Dynamic import, as in src/lib/llm/local.ts: the package is ESM-only with
  // top-level await, which tsx's CommonJS output cannot require statically.
  const { getLlama, LlamaChatSession, LlamaJsonSchemaGrammar, LlamaLogLevel } =
    await import("node-llama-cpp");
  const llama = await getLlama({
    logLevel: LlamaLogLevel.error,
    gpu: GPU ? "auto" : false,
  });

  const loadStart = performance.now();
  const model = await llama.loadModel({ modelPath });
  // One context kept for the whole session, as the app would keep it between
  // clicks. The sequence remembers evaluated tokens, so the system prompt's
  // KV cache is reused by every grade after the first.
  const context = await model.createContext({
    contextSize: 2048,
    threads: THREADS,
  });
  const loadMs = performance.now() - loadStart;

  const sequence = context.getSequence();
  const system =
    MODE === "app" ? GRADING_SYSTEM : MODE === "points" ? POINTS_SYSTEM : VERDICT_SYSTEM;
  const fixedGrammar =
    MODE === "points"
      ? null
      : new LlamaJsonSchemaGrammar(
          llama,
          (MODE === "app" ? toGrammarSchema(GRADE_SCHEMA) : VERDICT_SCHEMA) as never,
        );
  const maxTokens = MODE === "app" ? 200 : EVIDENCE ? 160 : 80;

  const samples: Sample[] = [];

  for (let run = 1; run <= RUNS; run++) {
    for (const fixture of CASES) {
      const prompt =
        MODE === "app"
          ? gradingPrompt(
              {
                question: fixture.question,
                expected: fixture.expected,
                essentialPoints: fixture.essentialPoints,
                misconceptions: fixture.misconceptions,
                answer: fixture.answer,
              },
              tokenizePoints({
                question: fixture.question,
                expected: fixture.expected,
                essentialPoints: fixture.essentialPoints,
                answer: fixture.answer,
              }),
            )
          : MODE === "points"
            ? pointsPrompt(fixture)
            : verdictPrompt(fixture);

      const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: system });

      // Clock starts where the button click would reach the model. The
      // per-question grammar is built inside the timed region, since the app
      // would build it per click too.
      const start = performance.now();
      const count = fixture.essentialPoints.length;
      const grammar =
        fixedGrammar ??
        new LlamaJsonSchemaGrammar(
          llama,
          pointsSchema(count, fixture.misconceptions?.length ?? 0) as never,
        );
      let first = 0;
      const text = await session.prompt(prompt, {
        grammar,
        temperature: 0,
        maxTokens,
        onTextChunk() {
          if (!first) first = performance.now();
        },
      });
      const end = performance.now();
      session.dispose({ disposeSequence: false });

      let got = "(unparseable)";
      let feedback = "";
      let marks = "";
      try {
        const parsed = grammar.parse(text) as unknown as Record<string, unknown>;
        if (MODE === "points") {
          ({ verdict: got, feedback, marks } = decidePoints(parsed, fixture));
        } else {
          got = String(parsed.verdict);
          feedback = String(parsed.feedback);
        }
      } catch {
        // Counted as a miss.
      }

      samples.push({
        run,
        name: fixture.name,
        ttftMs: first - start,
        totalMs: end - start,
        outTokens: model.tokenize(text).length,
        expected: fixture.verdict,
        got,
        ok: got === fixture.verdict,
        feedback,
        marks,
        set: fixture.set,
      });
    }
  }

  await context.dispose();
  await model.dispose();

  const warm = samples.filter((s) => !(s.run === 1 && s.name === CASES[0].name));
  const firstRun = samples.filter((s) => s.run === 1);
  const cold = samples[0];
  const totals = warm.map((s) => s.totalMs);
  const ttfts = warm.map((s) => s.ttftMs);
  const toks = warm.map((s) => s.outTokens);
  const correct = firstRun.filter((s) => s.ok).length;

  const levers = [FEWSHOT && "fewshot", TRAPS && "traps", EVIDENCE && "evidence", CODEFEEDBACK && "codefeedback"]
    .filter(Boolean)
    .join("+");
  console.log(
    `\n=== ${path.basename(modelPath)} · MODE=${MODE}${levers ? ` (${levers})` : ""} · ${GPU ? "GPU" : "CPU"} ===`,
  );
  console.log(`load (once per launch): ${fmt(loadMs)}`);
  console.log(`first grade, cold system prompt: TTFT ${fmt(cold.ttftMs)}, total ${fmt(cold.totalMs)}`);
  console.log(
    `warm grades (n=${warm.length}): TTFT p50 ${fmt(pct(ttfts, 50))} p95 ${fmt(pct(ttfts, 95))} | ` +
      `total p50 ${fmt(pct(totals, 50))} p95 ${fmt(pct(totals, 95))} max ${fmt(Math.max(...totals))}`,
  );
  console.log(
    `output tokens: min ${Math.min(...toks)} p50 ${pct(toks, 50)} max ${Math.max(...toks)}`,
  );
  console.log(
    `under 2 s: ${warm.filter((s) => s.totalMs < 2000).length}/${warm.length} · ` +
      `under 3 s: ${warm.filter((s) => s.totalMs < 3000).length}/${warm.length}`,
  );
  const bySet = ["orig", "heldout"]
    .map((set) => {
      const rows = firstRun.filter((s) => s.set === set);
      return rows.length ? `${set} ${rows.filter((s) => s.ok).length}/${rows.length}` : "";
    })
    .filter(Boolean)
    .join(" · ");
  console.log(`accuracy (run 1): ${correct}/${firstRun.length}  (${bySet})`);
  for (const s of firstRun.filter((s) => VERBOSE || !s.ok)) {
    console.log(
      `  ${s.ok ? "✓" : "✗"} ${s.name.padEnd(46)} want ${s.expected.padEnd(9)} got ${s.got.padEnd(9)} [${s.marks}] ${fmt(s.totalMs).padStart(7)}  "${s.feedback}"`,
    );
  }

  return { model: path.basename(modelPath), loadMs, cold, warm, correct, n: firstRun.length };
}

async function main() {
  const models = process.argv.slice(2);
  if (models.length === 0) {
    console.error("usage: npx tsx scripts/local-grade-bench.ts <model.gguf> [...]");
    process.exit(1);
  }
  for (const modelPath of models) await benchModel(path.resolve(modelPath));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
