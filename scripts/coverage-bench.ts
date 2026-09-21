/**
 * Times a real coverage check.
 *
 * Coverage rows are derived data that every run rewrites, so point this at a
 * copy of the database (DATABASE_URL) rather than the one you study from.
 *
 *   DATABASE_URL=/tmp/copy.db npm run coverage:bench -- <examId> [conflicts=on|off]
 *
 * COVERAGE_MODEL picks the Gemini model; COVERAGE_OUT writes each objective's
 * verdict to a JSON file, to compare two models' judgements.
 */
import { writeFileSync } from "node:fs";

import { eq } from "drizzle-orm";

import { createClient } from "@/db/client";
import { objectiveCoverage, studyGuideObjectives } from "@/db/schema";
import { analyzeCoverageForExam } from "@/lib/coverage";
import { createGeminiProvider, getProvider, type ThinkingEffort } from "@/lib/llm";

const [, , examId, conflicts = "on"] = process.argv;

async function main() {
  const db = createClient();
  const provider = process.env.COVERAGE_MODEL
    ? createGeminiProvider({ model: process.env.COVERAGE_MODEL })
    : getProvider();

  console.log(`provider ${provider.name}/${provider.model} · conflicts ${conflicts}`);
  const started = Date.now();
  const summary = await analyzeCoverageForExam(db, provider, examId, {
    skipConflicts: conflicts === "off",
    thinking: (process.env.COVERAGE_THINKING as ThinkingEffort | undefined) ?? undefined,
    onProgress(progress) {
      process.stdout.write(
        `\r  ${progress.phase} ${progress.batchIndex}/${progress.batchCount}        `,
      );
    },
  });
  console.log(`\n\nduration     ${Date.now() - started} ms`);
  console.log(JSON.stringify(summary));

  if (process.env.COVERAGE_OUT) {
    const rows = db
      .select({ text: studyGuideObjectives.promptText, status: objectiveCoverage.status, support: objectiveCoverage.sourceSupport })
      .from(objectiveCoverage)
      .innerJoin(studyGuideObjectives, eq(studyGuideObjectives.id, objectiveCoverage.objectiveId))
      .where(eq(studyGuideObjectives.examId, examId))
      .all();
    writeFileSync(process.env.COVERAGE_OUT, JSON.stringify(rows, null, 2));
  }
}

main().catch((error) => {
  console.error("FAILED:", error.message);
  process.exit(1);
});
