/**
 * End-to-end smoke test: upload → generate → coverage → learn → review-due.
 *
 *   npm run smoke
 *
 * Runs the real pipeline against a throwaway database with a stubbed
 * `LlmProvider`, so it needs no API key and costs nothing. The stub derives
 * its answers from the prompt it is given, which means the genuine validation
 * paths run: a card whose excerpt is not in the slide it cites still gets
 * rejected here, exactly as it would in production.
 *
 * This is the test that catches wiring, not logic — the unit suite covers
 * behaviour; this covers "do the pieces still fit together".
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "../src/db/schema";
import { flashcards, objectiveCoverage, sourceFiles, studyProgress } from "../src/db/schema";
import { analyzeCoverageForExam } from "../src/lib/coverage";
import {
  CONFLICT_SYSTEM,
  MAPPING_SYSTEM,
  REVIEW_SYSTEM,
} from "../src/lib/coverage/prompts";
import { generateCardsForExam } from "../src/lib/generate";
import { GENERATION_PREAMBLE } from "../src/lib/generate/prompts";
import { ingestSourceFile } from "../src/lib/ingest";
import { nextStep } from "../src/lib/learn/ladder";
import { loadLearn, startLearnSession, submitOutcome } from "../src/lib/learn/session";
import { createKeywordGrader } from "../src/lib/learn/typed";
import type { LlmProvider, StructuredRequest } from "../src/lib/llm";
import { createCourse, createExam } from "../src/lib/manage";
import { buildExamExport } from "../src/lib/manage/export";
import { addDays, isDue, todayIso } from "../src/lib/srs";
import { buildQueue } from "../src/lib/study/queue";
import { gradeCard, loadQueueCards } from "../src/lib/study/session";

const FIXTURES = join(process.cwd(), "src/lib/ingest/__fixtures__");

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  const mark = condition ? "ok  " : "FAIL";
  if (!condition) failures += 1;
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
}

function step(name: string) {
  console.log(`\n${name}`);
}

/* ------------------------------------------------------------- The stub LLM */

/** Pulls the rendered slides back out of a generation prompt. */
function slidesFromPrompt(prompt: string) {
  const body = prompt.slice(prompt.indexOf("SLIDES\n") + 7);

  return body
    .split("\n\n---\n\n")
    .map((block) => {
      const token = block.match(/^\[(S\d+)\]/)?.[1];
      const lines = block
        .split("\n")
        .slice(1)
        .map((line) => line.replace(/^Title: /, "").trim())
        .filter(Boolean);
      return token && lines.length > 0 ? { token, lines } : null;
    })
    .filter((slide): slide is { token: string; lines: string[] } => slide !== null);
}

function tokensFromPrompt(prompt: string, prefix: "O" | "C") {
  return [...prompt.matchAll(new RegExp(`\\[(${prefix}\\d+)\\]`, "g"))].map(
    (match) => match[1],
  );
}

/**
 * Answers every pass from the material it was handed.
 *
 * Excerpts are copied verbatim out of the prompt, so provenance verification
 * genuinely runs rather than being bypassed.
 */
function stubProvider(): LlmProvider {
  return {
    name: "smoke",
    model: "smoke",
    async generateStructured<T>(request: StructuredRequest) {
      // Every density builds a different system prompt, but they all open with
      // the same line, which is what identifies a generation request here.
      if (request.system.startsWith(GENERATION_PREAMBLE)) {
        const cards = slidesFromPrompt(request.prompt).map((slide, i) => ({
          topic: `Topic ${i + 1}`,
          facet: "definition",
          cardType: "atomic",
          question: `What does ${slide.token} say? (${slide.lines[0].slice(0, 30)})`,
          directAnswer: slide.lines[0],
          hasAiSupplement: false,
          slideCitation: slide.token,
          sourceExcerpt: slide.lines[0],
          essentialPoints: [slide.lines[0].slice(0, 20)],
        }));
        return { data: { cards, uncoveredNotes: [] } as T };
      }

      if (request.system === MAPPING_SYSTEM) {
        const cards = tokensFromPrompt(request.prompt, "C");
        const objectives = tokensFromPrompt(request.prompt, "O").map(
          (objective, i) => ({
            objective,
            status: cards[i] ? "covered" : "missing",
            cards: cards[i] ? [{ card: cards[i], status: "covered" }] : [],
            missingPoints: cards[i] ? [] : ["nothing in the deck covers this"],
            rationale: "stubbed",
          }),
        );
        return { data: { objectives } as T };
      }

      if (request.system === REVIEW_SYSTEM) {
        const reviews = tokensFromPrompt(request.prompt, "O").map(
          (objective) => ({
            objective,
            sourceSupport: "silent",
            slideCitation: "",
            sourceExcerpt: "",
            missingPoints: [],
            note: "stubbed",
          }),
        );
        return { data: { reviews } as T };
      }

      if (request.system === CONFLICT_SYSTEM) {
        return { data: { conflicts: [] } as T };
      }

      throw new Error("The stub was asked something it does not know about");
    },
  };
}

/* --------------------------------------------------------------- The script */

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "study-smoke-"));
  const sqlite = new Database(join(dir, "smoke.db"));
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });

  try {
    step("1. Create a subject and a deck");
    const course = createCourse(db, { title: "Smoke Physiology" });
    const exam = createExam(db, { courseId: course.id, title: "Smoke Exam" });
    check("deck created", Boolean(exam.id));

    step("2. Ingest slides, a study guide, and Word notes");
    const uploads = [
      { filename: "sample-deck.pptx", fileType: "pptx" as const, role: "slides" as const },
      { filename: "study-guide.pdf", fileType: "pdf" as const, role: "study_guide" as const },
      { filename: "sample-notes.docx", fileType: "docx" as const, role: "notes" as const },
    ];

    for (const upload of uploads) {
      const path = join(FIXTURES, upload.filename);
      const file = db
        .insert(sourceFiles)
        .values({
          examId: exam.id,
          filename: upload.filename,
          fileType: upload.fileType,
          role: upload.role,
          rawPath: path,
        })
        .returning()
        .get();

      await ingestSourceFile(db, file, path);

      const stored = db
        .select()
        .from(sourceFiles)
        .where(eq(sourceFiles.id, file.id))
        .get();
      check(`${upload.filename} ingested`, stored?.status === "ready", stored?.errorMessage ?? "");
    }

    const units = db.select().from(schema.sourceSlides).all();
    const objectives = db.select().from(schema.studyGuideObjectives).all();

    // Exact per format, not a loose floor: a regression in any one extractor
    // is exactly what this step exists to catch.
    const unitsPerFile = new Map(
      db
        .select()
        .from(sourceFiles)
        .all()
        .map((file) => [
          file.filename,
          units.filter((unit) => unit.sourceFileId === file.id).length,
        ]),
    );

    check("12 slides from the deck", unitsPerFile.get("sample-deck.pptx") === 12,
      `${unitsPerFile.get("sample-deck.pptx")}`);
    check("1 page from the study guide", unitsPerFile.get("study-guide.pdf") === 1,
      `${unitsPerFile.get("study-guide.pdf")}`);
    check("4 sections from the Word notes", unitsPerFile.get("sample-notes.docx") === 4,
      `${unitsPerFile.get("sample-notes.docx")}`);
    check("objectives parsed", objectives.length === 4, `${objectives.length} objectives`);
    check(
      "DOCX sections keep their headings",
      units.some((unit) => unit.title === "Acid-Base Balance"),
    );

    step("3. Re-ingesting the same file is non-destructive");
    const guide = db
      .select()
      .from(sourceFiles)
      .where(eq(sourceFiles.filename, "study-guide.pdf"))
      .get()!;
    const before = db.select().from(schema.studyGuideObjectives).all();
    await ingestSourceFile(db, guide, join(FIXTURES, "study-guide.pdf"));
    const after = db.select().from(schema.studyGuideObjectives).all();
    check(
      "objective ids survive re-ingestion",
      before.every((o) => after.some((a) => a.id === o.id)),
    );

    step("4. Generate cards with verified provenance");
    const llm = stubProvider();
    const generation = await generateCardsForExam(db, llm, exam.id);
    check("cards created", generation.cardsCreated > 0, `${generation.cardsCreated} cards`);
    check("nothing rejected", generation.cardsRejected === 0, `${generation.cardsRejected} rejected`);

    const cards = db.select().from(flashcards).all();
    check(
      "every card cites a real slide",
      cards.every((card) => card.sourceSlideId !== null),
    );

    step("5. Build the coverage matrix");
    const coverage = await analyzeCoverageForExam(db, llm, exam.id);
    check("every objective judged", coverage.objectives === 4);
    check(
      "verdicts stored",
      db.select().from(objectiveCoverage).all().length === 4,
    );
    check("no invented references", coverage.unresolvedReferences === 0);

    step("6. Run a Learn round");
    const grader = createKeywordGrader();
    const session = startLearnSession(db, exam.id, { scope: "all", roundSize: 5 });
    check("round opened", (session.roundState?.concepts.length ?? 0) === 5);

    let guard = 0;
    while (guard++ < 80) {
      const view = loadLearn(db, session.id)!;
      const current = view.state ? nextStep(view.state) : null;
      if (!current) break;

      const card = cards.find((row) => row.id === current.cardId)!;
      const answer = current.stage === "mcq" ? card.directAnswer : card.directAnswer;
      const grade = await grader.grade({
        question: card.question,
        expected: card.directAnswer,
        essentialPoints: [],
        answer,
      });

      submitOutcome(db, session.id, current.cardId, {
        correct: grade.verdict === "correct",
        verdict: grade.verdict,
        metPoints: grade.metPoints,
      });
    }

    const learned = db.select().from(studyProgress).all();
    check("progress recorded", learned.length === 5, `${learned.length} cards`);
    check(
      "recall mastery reached, not just recognition",
      learned.some((row) => row.state === "immediate_recall"),
    );
    check(
      "no scheduling from recognition alone",
      learned.every((row) => row.retentionCount === 0),
    );

    step("7. Grade a card in flashcard mode and schedule it");
    const spare = cards.find(
      (card) => !learned.some((row) => row.flashcardId === card.id),
    )!;
    gradeCard(db, spare.id, "easy");
    const scheduled = db
      .select()
      .from(studyProgress)
      .where(eq(studyProgress.flashcardId, spare.id))
      .get()!;
    check("review scheduled", scheduled.intervalDays > 0);
    check("due date set", scheduled.nextReviewDue === addDays(todayIso(), 1));

    step("8. Work a due queue");
    db.update(studyProgress)
      .set({ nextReviewDue: addDays(todayIso(), -3) })
      .where(eq(studyProgress.flashcardId, spare.id))
      .run();

    const due = buildQueue(loadQueueCards(db, exam.id), { scope: "due" });
    check("overdue card is due", due.includes(spare.id), `${due.length} due`);
    check(
      "cards with no schedule are not due",
      due.length < cards.length,
    );
    check(
      "overdue is simply due",
      isDue({ nextReviewDue: addDays(todayIso(), -3) }),
    );

    step("9. Export the deck");
    const bundle = buildExamExport(db, exam.id)!;
    check("export has the cards", bundle.flashcards.length === cards.length);
    check("export has the sources", bundle.sourceFiles.length === 3);
    check("export has review history", bundle.flashcards.some((c) => c.progress));
    check("export serializes", JSON.stringify(bundle).length > 1000);
  } finally {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(
    failures === 0
      ? "\nSmoke test passed.\n"
      : `\nSmoke test FAILED: ${failures} check(s).\n`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
