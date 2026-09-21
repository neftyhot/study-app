/**
 * Times a real generation run against a throwaway copy of a deck.
 *
 * The copy shares the uploads on disk and is deleted at the end, so the
 * student's own deck is never touched. Nothing here is stubbed: the point is
 * the wall-clock of the actual provider, which no test can tell you.
 *
 *   npm run generate:bench -- <examId> [density] [detail] [concurrency] [batchSize]
 */
import { eq } from "drizzle-orm";

import { createClient } from "@/db/client";
import { exams, flashcards, sourceFiles } from "@/db/schema";
import { generateCardsForExam } from "@/lib/generate";
import type { GenerationDetail } from "@/lib/generate/schemas";
import { formatCost, getProvider } from "@/lib/llm";
import { deleteExam, duplicateExamSources } from "@/lib/manage";

const [
  ,
  ,
  examId,
  density = "standard",
  detail = "lean",
  concurrency = "5",
  /** Defaults to the model's calibrated batch size. */
  batchSize,
  /** Optional: only files whose name contains this, e.g. one chapter. */
  fileMatch,
] = process.argv;

if (!examId) {
  console.error("Usage: generate-bench <examId> [density] [detail] [concurrency] [batchSize]");
  process.exit(1);
}

async function main() {
  const db = createClient();
  const provider = getProvider(undefined, "bulk");

  const copy = duplicateExamSources(db, examId, `BENCH ${new Date().toISOString()}`);
  if (!copy) throw new Error("No such exam");

  db.update(exams)
    .set({
      extractionDensity: density as never,
      // Full coverage: a study-guide run measures the guide, not the deck.
      scopeMode: "files",
    })
    .where(eq(exams.id, copy.id))
    .run();

  const sourceFileIds = fileMatch
    ? db
        .select()
        .from(sourceFiles)
        .where(eq(sourceFiles.examId, copy.id))
        .all()
        .filter((file) => file.filename.toLowerCase().includes(fileMatch.toLowerCase()))
        .map((file) => file.id)
    : undefined;

  console.log(
    `provider ${provider.name}/${provider.model} · density ${density} · detail ${detail} · concurrency ${concurrency} · batch ${batchSize}`,
  );

  try {
    let last = 0;
    const summary = await generateCardsForExam(db, provider, copy.id, {
      batchSize: batchSize ? Number(batchSize) : undefined,
      concurrency: Number(concurrency),
      sourceFileIds,
      detail: detail as GenerationDetail,
      onProgress(progress) {
        if (progress.batchIndex === last) return;
        last = progress.batchIndex;
        process.stdout.write(
          `\r  ${progress.batchIndex}/${progress.batchCount} batches · ${progress.cardsCreated} cards   `,
        );
      },
    });

    console.log("\n");
    console.log(`units        ${summary.unitsUsed}`);
    console.log(`batches      ${summary.batchCount}`);
    console.log(`cards        ${summary.cardsCreated} (${summary.cardsRejected} rejected)`);
    console.log(`per unit     ${(summary.cardsCreated / summary.unitsUsed).toFixed(2)}`);
    console.log(`duration     ${summary.durationMs} ms (${(summary.durationMs / 1000).toFixed(1)}s)`);
    console.log(
      `tokens       ${summary.usage.inputTokens} in / ${summary.usage.outputTokens} out · ${formatCost(summary.usage.estimatedCostUsd)} on ${summary.model}`,
    );

    const reasons = new Map<string, number>();
    for (const rejection of summary.rejections) {
      reasons.set(rejection.reason, (reasons.get(rejection.reason) ?? 0) + 1);
    }
    if (reasons.size > 0) {
      console.log(
        `rejected     ${[...reasons].map(([reason, count]) => `${reason} ${count}`).join(", ")}`,
      );
    }

    if (process.env.BENCH_REJECTIONS) {
      for (const rejection of summary.rejections.slice(0, Number(process.env.BENCH_REJECTIONS))) {
        console.log(`\n[${rejection.reason}] ${rejection.card.slideCitation}: ${rejection.card.sourceExcerpt}\n  ${rejection.detail}`);
      }
    }

    // BENCH_SAMPLE=8 prints that many cards, to read the quality as well as
    // count it before the throwaway deck is deleted.
    const sample = Number(process.env.BENCH_SAMPLE ?? 0);
    if (sample > 0) {
      const cards = db
        .select()
        .from(flashcards)
        .where(eq(flashcards.examId, copy.id))
        .all()
        .sort(() => Math.random() - 0.5)
        .slice(0, sample);
      for (const card of cards) {
        console.log(`\n[${card.topic}]${card.professorEmphasis ? " *emphasis*" : ""}\nQ: ${card.question}\nA: ${card.directAnswer}\nExcerpt: ${card.sourceExcerpt}`);
      }
    }
    if (summary.failedBatches.length > 0) {
      console.log(`failed       ${summary.failedBatches.length}: ${summary.failedBatches[0].error}`);
    }
  } finally {
    deleteExam(db, copy.id);
    console.log("\nthrowaway deck deleted");
  }
}

main().catch((error) => {
  console.error("FAILED:", error.message);
  process.exit(1);
});
