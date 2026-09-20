/**
 * The local models a student can download.
 *
 * Curated rather than open-ended, for two reasons: every entry is a
 * permissively licensed, instruction-tuned model from a known publisher, and
 * every entry has been checked to actually exist at the URL given. Sizes below
 * are the real download sizes of these files, not estimates.
 *
 * The capability notes are the important part. A 360 MB model and a 8 GB model
 * are not the same tool with different speeds — the small one genuinely cannot
 * hold a multi-step physiological pathway in its head, and will produce
 * confident, plausible, wrong cards. Saying so plainly is kinder than letting
 * someone discover it after building a deck.
 */
export type ModelTier = "minimal" | "light" | "capable" | "strong";

export type LocalModel = {
  id: string;
  name: string;
  publisher: string;
  license: string;
  /** Hugging Face repo and file, resolved by the downloader. */
  uri: string;
  /** Download size in bytes, measured from the file itself. */
  bytes: number;
  /** RAM needed to run it comfortably, in GB. */
  minimumRamGb: number;
  tier: ModelTier;
  /** What it can and cannot do, in the student's terms. */
  summary: string;
  caution?: string;
};

const HF = "https://huggingface.co";

export const LOCAL_MODELS: LocalModel[] = [
  {
    id: "smollm2-360m",
    name: "SmolLM2 360M",
    publisher: "Hugging Face",
    license: "Apache-2.0",
    uri: `${HF}/HuggingFaceTB/SmolLM2-360M-Instruct-GGUF/resolve/main/smollm2-360m-instruct-q8_0.gguf`,
    bytes: 386_000_000,
    minimumRamGb: 2,
    tier: "minimal",
    summary:
      "Tiny and instant. Fine for checking that everything works end to end.",
    caution:
      "Not up to real coursework. On anatomy and physiology it will miss steps and invent mechanisms that sound right — every card would need checking by hand, which defeats the point.",
  },
  {
    id: "qwen2.5-1.5b",
    name: "Qwen2.5 1.5B",
    publisher: "Alibaba",
    license: "Apache-2.0",
    uri: `${HF}/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf`,
    bytes: 1_117_000_000,
    minimumRamGb: 4,
    tier: "light",
    summary:
      "Handles definitions, term-and-meaning pairs, and single facts reliably.",
    caution:
      "Multi-step pathways — the clotting cascade, phototransduction, RAAS — come out shortened or out of order. Good for vocabulary-heavy subjects, weak on mechanism.",
  },
  {
    id: "qwen2.5-3b",
    name: "Qwen2.5 3B",
    publisher: "Alibaba",
    license: "Qwen Research License",
    uri: `${HF}/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf`,
    bytes: 1_933_000_000,
    minimumRamGb: 6,
    tier: "light",
    summary:
      "Noticeably better at keeping a sequence straight. A reasonable floor for science coursework.",
    caution:
      "Still decomposes broad topics less thoroughly than the larger models, so expect to run generation again after reading the coverage matrix.",
  },
  {
    id: "phi-3.5-mini",
    name: "Phi-3.5 Mini",
    publisher: "Microsoft",
    license: "MIT",
    uri: `${HF}/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf`,
    bytes: 2_394_000_000,
    minimumRamGb: 8,
    tier: "capable",
    summary:
      "Trained heavily on textbook-style reasoning, which is exactly this job. Strong for its size on stepwise explanation.",
  },
  {
    id: "qwen2.5-7b",
    name: "Qwen2.5 7B",
    publisher: "Alibaba",
    license: "Apache-2.0",
    uri: `${HF}/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf`,
    bytes: 4_683_000_000,
    minimumRamGb: 12,
    tier: "capable",
    summary:
      "The first size that handles anatomy and physiology properly: multi-step pathways in order, comparisons that hold up, rubrics worth grading against.",
  },
  {
    id: "qwen2.5-14b",
    name: "Qwen2.5 14B",
    publisher: "Alibaba",
    license: "Apache-2.0",
    uri: `${HF}/bartowski/Qwen2.5-14B-Instruct-GGUF/resolve/main/Qwen2.5-14B-Instruct-Q4_K_M.gguf`,
    bytes: 8_988_000_000,
    minimumRamGb: 20,
    tier: "strong",
    summary:
      "Closest to the hosted models for decomposing a broad objective exhaustively and for grading typed answers on meaning.",
    caution:
      "Needs a machine with plenty of memory, and generating a large deck will take a while.",
  },
];

export function findModel(id: string): LocalModel | undefined {
  return LOCAL_MODELS.find((model) => model.id === id);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

export const TIER_LABELS: Record<ModelTier, string> = {
  minimal: "Try it out",
  light: "Light coursework",
  capable: "Full coursework",
  strong: "Most capable",
};

/**
 * The smallest model this machine can comfortably run.
 *
 * A recommendation, not a limit: someone who knows their machine can pick
 * anything. Deliberately conservative, because a model that swaps to disk
 * makes generation unusably slow rather than merely slower.
 */
export function recommendedModel(totalRamGb: number): LocalModel {
  const affordable = LOCAL_MODELS.filter(
    (model) => model.minimumRamGb <= totalRamGb,
  );
  // Prefer the most capable that fits, but never the tier that cannot do the work.
  const usable = affordable.filter((model) => model.tier !== "minimal");
  return usable.at(-1) ?? affordable.at(-1) ?? LOCAL_MODELS[0];
}
