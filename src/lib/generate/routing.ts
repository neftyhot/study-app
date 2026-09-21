/**
 * Which study-guide objectives each batch of slides is asked about.
 *
 * Sending every objective with every batch was wasteful twice over. Each of
 * forty batches paid to read all forty-eight objectives, and each batch then
 * reported the forty-odd objectives its own eight pages did not answer — which
 * is how a 48-objective guide produced 1,400 "not covered" notes.
 *
 * Instead each objective goes to the batches whose pages share its rare terms
 * (the same IDF ranking the coverage check uses), and always to its best few,
 * so no objective can be routed nowhere. This is a filter on what the model is
 * shown; the model still decides what a card is.
 */
import type { SourceSlide, StudyGuideObjective } from "@/db/schema";
import { buildIdf, relevance } from "@/lib/coverage/candidates";

export type RoutingOptions = {
  /** Every objective goes to at least this many of its best batches. */
  minBatches?: number;
  /** Also to any batch scoring at least this share of its best batch. */
  relativeScore?: number;
  /** Scores below this never count as a match on their own. */
  floor?: number;
};

export function batchText(batch: SourceSlide[]): string {
  return batch
    .map((slide) =>
      [
        slide.title ?? "",
        slide.rawText,
        slide.speakerNotes ?? "",
        slide.tables.flatMap((t) => t.rows.flat()).join(" "),
      ].join(" "),
    )
    .join(" ");
}

/** For each batch, the objectives to show it, in guide order. */
export function routeObjectives(
  batches: SourceSlide[][],
  objectives: StudyGuideObjective[],
  options: RoutingOptions = {},
): StudyGuideObjective[][] {
  const { minBatches = 4, relativeScore = 0.4, floor = 0.2 } = options;

  const texts = batches.map(batchText);
  const idf = buildIdf(texts);
  const routed = batches.map(() => new Set<number>());

  objectives.forEach((objective, objectiveIndex) => {
    const scores = texts
      .map((text, batchIndex) => ({
        batchIndex,
        score: relevance(objective.promptText, text, idf),
      }))
      .sort((a, b) => b.score - a.score);

    const best = scores[0]?.score ?? 0;

    scores.forEach(({ batchIndex, score }, rankIndex) => {
      const strong = score >= floor && score >= best * relativeScore;
      if (rankIndex < minBatches || strong) routed[batchIndex].add(objectiveIndex);
    });
  });

  return routed.map((set) =>
    [...set].sort((a, b) => a - b).map((index) => objectives[index]),
  );
}
