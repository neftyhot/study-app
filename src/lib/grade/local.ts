/**
 * Check Answer on this computer.
 *
 * A small model is bad at judging a whole answer and good at a narrower
 * question: for each required point, did the student state it, leave it out,
 * or say the opposite? So that is all it is asked. The verdict and the
 * feedback are then worked out here, in code, from those marks — the same
 * split the API grader uses, where the model reports and `reconcileGrade`
 * decides.
 *
 * Measured with scripts/local-grade-bench.ts on Qwen3-4B-Instruct Q4_K_M:
 * 46/46 on the grading fixtures plus the held-out set, about 0.6 s a grade
 * once warm on Apple silicon.
 *
 * The model, its context and the system prompt's KV cache are kept between
 * grades, so only the student's answer is new work. This is separate from the
 * offline chat provider (lib/llm/local.ts) so switching that provider never
 * unloads the grader mid-session.
 */
import type {
  TypedAnswerGrader,
  TypedGrade,
  TypedRequest,
} from "@/lib/learn/typed";

import { tokenizePoints } from "./prompts";
import { reconcileGrade } from "./semantic";
import type { GradeResponse } from "./schemas";
import { DEFAULT_STRICTNESS, type Strictness } from "./strictness";

type Mark = "stated" | "missing" | "contradicted";

const RULES = `You check a student's answer against required points, one point at a time.
For each point answer exactly one of:
- "stated": the answer says it, in any words. Synonyms, paraphrase, abbreviations (ADH = vasopressin), symbols, typos, and very short answers all count.
- "missing": the answer does not mention it.
- "contradicted": the answer says the opposite direction (decreases instead of increases, inhibits instead of stimulates) or a different site, organ, cell, receptor, or process (proximal tubule instead of collecting duct, medulla instead of cortex).
Judge only what the student wrote.`;

const EXAMPLES: { question: string; points: string[]; answer: string; marks: Mark[] }[] = [
  {
    question: "Where does glycolysis occur, and what is its net ATP yield?",
    points: ["cytoplasm", "net 2 ATP"],
    answer: "in the cytosol, you net two atp",
    marks: ["stated", "stated"],
  },
  {
    question: "What does glucagon do to blood glucose?",
    points: ["raises blood glucose"],
    answer: "it lowers blood sugar so it doesn't get too high",
    marks: ["contradicted"],
  },
  {
    question:
      "Which vessels carry oxygenated blood from the lungs to the heart, and into which chamber?",
    points: ["pulmonary veins", "left atrium"],
    answer: "the pulmonary arteries, into the left atrium",
    marks: ["contradicted", "stated"],
  },
  {
    question: "What do thyroid hormones do to metabolic rate, and which gland makes them?",
    points: ["increase metabolic rate", "thyroid gland"],
    answer: "T3/T4 speed up metabolism",
    marks: ["stated", "missing"],
  },
  {
    question: "What neurotransmitter is released at the neuromuscular junction?",
    points: ["acetylcholine"],
    answer: "no idea",
    marks: ["missing"],
  },
];

export function renderPoints(question: string, points: string[], answer: string) {
  const lines = points.map((point, i) => `P${i + 1}: ${point}`).join("\n");
  return `Question: ${question}\nRequired points:\n${lines}\nStudent's answer: "${answer}"`;
}

function marksJson(marks: Mark[]) {
  return JSON.stringify(Object.fromEntries(marks.map((mark, i) => [`P${i + 1}`, mark])));
}

export const LOCAL_GRADING_SYSTEM =
  RULES +
  "\n\nExamples:\n\n" +
  EXAMPLES.map(
    (example) =>
      `${renderPoints(example.question, example.points, example.answer)}\nOutput: ${marksJson(example.marks)}`,
  ).join("\n\n");

function pointsSchema(count: number) {
  const mark = { type: "string", enum: ["stated", "missing", "contradicted"] };
  const properties: Record<string, unknown> = {};
  for (let i = 1; i <= count; i++) properties[`P${i}`] = mark;
  return { type: "object", properties, required: Object.keys(properties) };
}

/** A contradicted point that names a direction is a reversal; any other is the wrong site or process. */
const DIRECTION =
  /\b(increase|decrease|raise|lower|rise|fall|up|down|stimulat|inhibit|promot|suppress|retain|excret|more|less|higher|lower|faster|slower|constrict|dilat|unchanged|same)/i;

/**
 * Turns per-point marks into a grade. Exported for tests: this is where the
 * verdict comes from, not the model.
 */
export function gradeFromMarks(
  request: TypedRequest,
  marks: Mark[],
  strictness: Strictness = DEFAULT_STRICTNESS,
): TypedGrade {
  const points = tokenizePoints(request);
  const required = points.required;

  const stated = required.filter((_, i) => marks[i] === "stated");
  const contradicted = required.filter((_, i) => marks[i] === "contradicted");
  const missing = required.filter((_, i) => marks[i] !== "stated" && marks[i] !== "contradicted");

  const errorType: GradeResponse["errorType"] = contradicted.length
    ? contradicted.some((point) => DIRECTION.test(point.text))
      ? "directionality"
      : "mechanism"
    : stated.length === 0
      ? "unrelated"
      : missing.length
        ? "incomplete"
        : "none";

  const grade = reconcileGrade(
    {
      verdict: "incorrect",
      errorType,
      metPoints: stated.map((point) => point.token),
      missedPoints: [...contradicted, ...missing].map((point) => point.token),
      creditedOptional: [],
      feedback: "",
    },
    points,
    { strictness },
  );

  const wrong = contradicted.map((point) => point.text);
  const missed = missing.map((point) => point.text);
  const feedback =
    grade.verdict === "correct" && missed.length === 0
      ? "Correct."
      : wrong.length
        ? `Check this: ${wrong.join("; ")}.`
        : stated.length === 0
          ? `The answer: ${request.expected}`
          : `Also needed: ${missed.join("; ")}.`;

  return { ...grade, feedback };
}

/* ---------------------------------------------------------------- runtime */

const CONTEXT_SIZE = 2048;
const MAX_TOKENS = 80;

type Warm = {
  path: string;
  llama: import("node-llama-cpp").Llama;
  model: import("node-llama-cpp").LlamaModel;
  context: import("node-llama-cpp").LlamaContext;
  sequence: import("node-llama-cpp").LlamaContextSequence;
};

let warm: Promise<Warm> | null = null;
let warmPath: string | null = null;
/** One sequence, so one grade at a time; a second click waits its turn. */
let queue: Promise<unknown> = Promise.resolve();

async function load(path: string): Promise<Warm> {
  if (warm && warmPath === path) return warm;
  if (warm) await unloadLocalGrader();

  warmPath = path;
  warm = (async () => {
    const { getLlama, LlamaLogLevel } = await import("node-llama-cpp");
    const llama = await getLlama({ logLevel: LlamaLogLevel.error });
    const model = await llama.loadModel({ modelPath: path });
    const context = await model.createContext({
      contextSize: Math.min(CONTEXT_SIZE, model.trainContextSize),
    });
    return { path, llama, model, context, sequence: context.getSequence() };
  })();

  // A failed load must not be cached, or every later grade fails the same way.
  warm.catch(() => {
    if (warmPath === path) {
      warm = null;
      warmPath = null;
    }
  });

  return warm;
}

export async function unloadLocalGrader() {
  const current = warm;
  warm = null;
  warmPath = null;
  try {
    const loaded = await current;
    await loaded?.context.dispose();
    await loaded?.model.dispose();
  } catch {
    // Never loaded; nothing to free.
  }
}

function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

async function mark(path: string, prompt: string, count: number): Promise<Mark[]> {
  const { llama, sequence } = await load(path);
  const { LlamaChatSession, LlamaJsonSchemaGrammar } = await import("node-llama-cpp");

  const grammar = new LlamaJsonSchemaGrammar(llama, pointsSchema(count) as never);
  const session = new LlamaChatSession({
    contextSequence: sequence,
    systemPrompt: LOCAL_GRADING_SYSTEM,
  });

  try {
    const text = await session.prompt(prompt, {
      grammar,
      temperature: 0,
      maxTokens: MAX_TOKENS,
    });
    const parsed = (grammar.parse(text) ?? {}) as unknown as Record<string, Mark>;
    return Array.from({ length: count }, (_, i) => parsed[`P${i + 1}`] ?? "missing");
  } finally {
    // Keep the sequence: its cached system prompt is what makes the next grade fast.
    session.dispose({ disposeSequence: false });
  }
}

/**
 * Loads the model and runs one throwaway grade so the system prompt is in the
 * cache before the student's first real answer. Safe to call repeatedly.
 */
export function prewarmLocalGrader(path: string): Promise<void> {
  return serial(async () => {
    await mark(path, renderPoints("What is 2 + 2?", ["4"], "four"), 1);
  });
}

export function createLocalGrader(options: {
  modelPath: string;
  strictness?: Strictness;
}): TypedAnswerGrader {
  const strictness = options.strictness ?? DEFAULT_STRICTNESS;

  return {
    name: `local (${strictness})`,

    async grade(request: TypedRequest): Promise<TypedGrade> {
      const points = tokenizePoints(request);

      if (request.answer.trim().length === 0) {
        return {
          verdict: "incorrect",
          metPoints: [],
          missedPoints: points.required.map((point) => point.text),
          creditedOptional: [],
          errorType: "unrelated",
          feedback: "No answer given.",
          provisional: false,
        };
      }

      const texts = points.required.map((point) => point.text);
      const marks = await serial(() =>
        mark(options.modelPath, renderPoints(request.question, texts, request.answer), texts.length),
      );
      return gradeFromMarks(request, marks, strictness);
    },
  };
}
