/**
 * Conflict detection across files (PRD §3).
 *
 * Contradictions only matter between slides that discuss the same thing, and
 * only across files — a professor's deck and a textbook chapter disagreeing on
 * a value is exactly what the student needs flagged. Comparing every slide
 * with every other slide would be mostly noise and entirely wasted tokens, so
 * slides are paired by term overlap first and only the overlapping pairs are
 * sent to the model.
 */
import pLimit from "p-limit";

import type { StructuredRequest } from "@/lib/llm";

import { buildIdf, similarity } from "./candidates";
import {
  CONFLICT_SYSTEM,
  conflictPrompt,
  tokenize,
  type LabeledSlide,
} from "./prompts";
import { CONFLICT_SCHEMA, type ConflictResponse } from "./schemas";
import { validateConflicts, type ResolvedConflict } from "./validate";

export function slideText({ slide }: LabeledSlide): string {
  return [
    slide.title ?? "",
    slide.rawText,
    slide.speakerNotes ?? "",
    slide.tables.flatMap((t) => t.rows.flat()).join(" "),
  ].join(" ");
}

export type SlidePair = { a: LabeledSlide; b: LabeledSlide; score: number };

export type PairOptions = {
  /** Minimum statement overlap for two slides to be worth comparing. */
  minScore?: number;
  /** Cross-file matches kept per slide. */
  matchesPerSlide?: number;
  maxPairs?: number;
};

/**
 * Splits a slide into the statements a contradiction could live in.
 *
 * Scoring whole slides buries the signal: a one-line note contradicting one
 * bullet of a dense slide barely registers against everything else on it.
 * Comparing statement to statement finds that pair, and the statements it
 * matches on are the ones the model is being asked about.
 */
export function statements(labeled: LabeledSlide): string[] {
  const { slide } = labeled;

  return [
    slide.title ?? "",
    slide.rawText,
    slide.speakerNotes ?? "",
    ...slide.tables.flatMap((t) => t.rows.map((row) => row.join(" "))),
  ]
    .join("\n")
    .split(/\n+|(?<=[.;:!?])\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 12);
}

/**
 * Pairs slides across files by their closest pair of statements.
 *
 * The threshold is deliberately loose. Lexical similarity cannot recognise a
 * contradiction — "released from the posterior pituitary" and "released from
 * the anterior pituitary" disagree precisely in the words that do not match,
 * so the true pair never ranks top. Retrieval's only job here is to bound how
 * many comparisons reach the model; the model is what decides.
 */
export function pairSlidesAcrossFiles(
  slides: LabeledSlide[],
  options: PairOptions = {},
): SlidePair[] {
  const {
    minScore = 0.2,
    matchesPerSlide = 2,
    // Scales with the material so a large deck does not hide every
    // contradiction behind a dozen near-duplicate pairs.
    maxPairs = Math.min(Math.max(12, Math.ceil(slides.length / 4)), 30),
  } = options;

  const byFile = new Map<string, LabeledSlide[]>();
  for (const labeled of slides) {
    const existing = byFile.get(labeled.slide.sourceFileId) ?? [];
    existing.push(labeled);
    byFile.set(labeled.slide.sourceFileId, existing);
  }

  if (byFile.size < 2) return [];

  const idf = buildIdf(slides.map(slideText));
  const parts = new Map(slides.map((s) => [s.slide.id, statements(s)]));

  const score = (a: LabeledSlide, b: LabeledSlide): number => {
    let best = 0;
    for (const left of parts.get(a.slide.id) ?? []) {
      for (const right of parts.get(b.slide.id) ?? []) {
        best = Math.max(best, similarity(left, right, idf));
      }
    }
    return best;
  };

  const pairs = new Map<string, SlidePair>();
  const files = [...byFile.values()];

  const keep = (candidates: SlidePair[]) => {
    for (const match of candidates
      .filter((pair) => pair.score >= minScore)
      .sort((x, y) => y.score - x.score)
      .slice(0, matchesPerSlide)) {
      const key = [match.a.slide.id, match.b.slide.id].sort().join("|");
      const existing = pairs.get(key);
      if (!existing || match.score > existing.score) pairs.set(key, match);
    }
  };

  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      const scores = files[i].map((a) =>
        files[j].map((b) => ({ a, b, score: score(a, b) })),
      );

      // Both directions: a three-page set of notes gets its own best matches
      // in a sixty-slide deck, instead of whichever file is iterated first
      // deciding how many pairs exist at all.
      for (const row of scores) keep(row);
      for (let column = 0; column < files[j].length; column += 1) {
        keep(scores.map((row) => row[column]));
      }
    }
  }

  return [...pairs.values()]
    .sort((x, y) => y.score - x.score)
    .slice(0, maxPairs);
}

export type ConflictScan = {
  conflicts: ResolvedConflict[];
  pairsChecked: number;
  unverified: number;
};

export type ConflictOptions = PairOptions & {
  /** Pairs per model call. Small keeps the comparison focused. */
  pairsPerCall?: number;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
};

/** Anything that can make a structured call — a provider's, or a meter's. */
export type StructuredCaller = {
  call<T>(request: StructuredRequest): Promise<T>;
};

export async function scanForConflicts(
  caller: StructuredCaller,
  slides: LabeledSlide[],
  options: ConflictOptions = {},
): Promise<ConflictScan> {
  const pairs = pairSlidesAcrossFiles(slides, options);
  if (pairs.length === 0) {
    return { conflicts: [], pairsChecked: 0, unverified: 0 };
  }

  const pairsPerCall = options.pairsPerCall ?? 3;
  const groups: SlidePair[][] = [];
  for (let i = 0; i < pairs.length; i += pairsPerCall) {
    groups.push(pairs.slice(i, i + pairsPerCall));
  }

  const limit = pLimit(options.concurrency ?? 1);
  let done = 0;
  options.onProgress?.(0, groups.length);

  const results = await Promise.all(
    groups.map((batch) =>
      limit(async () => {
        const unique = new Map<string, LabeledSlide>();
        for (const pair of batch) {
          unique.set(pair.a.slide.id, pair.a);
          unique.set(pair.b.slide.id, pair.b);
        }

        const tokenized = tokenize("S", [...unique.values()]);

        const data = await caller.call<ConflictResponse>({
          system: CONFLICT_SYSTEM,
          prompt: conflictPrompt(tokenized),
          schema: CONFLICT_SCHEMA,
          temperature: 0,
        });

        const result = validateConflicts(data, tokenized);
        done += 1;
        options.onProgress?.(done, groups.length);
        return result;
      }),
    ),
  );

  return {
    conflicts: results.flatMap((result) => result.conflicts),
    pairsChecked: pairs.length,
    unverified: results.reduce((sum, r) => sum + r.unverified, 0),
  };
}
