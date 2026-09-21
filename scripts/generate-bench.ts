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
import { exams, sourceFiles } from "@/db/schema";
import { generateCardsForExam } from "@/lib/generate";
import type { GenerationDetail } from "@/lib/generate/schemas";
import { getProvider } from "@/lib/llm";
import { deleteExam, duplicateExamSources } from "@/lib/manage";

const [
  ,
  ,
  examId,
  density = "standard",
  detail = "lean",
  concurrency = "5",
  batchSize = "18",
  /** Optional: only files whose name contains this, e.g. one chapter. */
  fileMatch,
] = process.argv;

if (!examId) {
  console.error("Usage: generate-bench <examId> [density] [detail] [concurrency] [batchSize]");
  process.exit(1);
}

async function main() {
  const db = createClient();
  const provider = getProvider();

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
      batchSize: Number(batchSize),
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
