/**
 * Sitting and marking a practice exam (PRD §11).
 *
 * The rule that shapes everything here: nothing is marked, and nothing is
 * revealed, until the paper is submitted. A study session tells you how you
 * did as you go, which is how it teaches; an exam must not, because the value
 * of sitting one is finding out what you know without that support.
 */
import { and, asc, desc, eq, isNull } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  cardRubrics,
  flashcards,
  practiceExams,
  practiceQuestions,
  sourceFiles,
  sourceSlides,
  studyProgress,
  type PracticeExam,
} from "@/db/schema";
import { buildMcq, placeCorrect } from "@/lib/learn/mcq";
import { dealPositions } from "@/lib/random";
import type { TypedAnswerGrader } from "@/lib/learn/typed";

import {
  assignFormats,
  DEFAULT_QUESTION_COUNT,
  DEFAULT_TYPED_SHARE,
  interleave,
  selectCards,
  type PaperCard,
  type PaperScope,
} from "./paper";

export * from "./paper";
export { difference, rejectRewrite, rewriteQuestions } from "./rewrite";
export { acceptOptions, writeOptions } from "./options";

export function loadPaperCards(db: Db, examId: string): PaperCard[] {
  return db
    .select({
      id: flashcards.id,
      topic: flashcards.topic,
      question: flashcards.question,
      directAnswer: flashcards.directAnswer,
      cardType: flashcards.cardType,
      excluded: flashcards.excluded,
      essentialPoints: cardRubrics.essentialPoints,
      misconceptions: cardRubrics.commonMisconceptions,
      state: studyProgress.state,
      sourceFileId: sourceSlides.sourceFileId,
      slideIndex: sourceSlides.index,
    })
    .from(flashcards)
    .leftJoin(cardRubrics, eq(cardRubrics.flashcardId, flashcards.id))
    .leftJoin(studyProgress, eq(studyProgress.flashcardId, flashcards.id))
    .leftJoin(sourceSlides, eq(sourceSlides.id, flashcards.sourceSlideId))
    .where(eq(flashcards.examId, examId))
    .all()
    .map((row) => ({
      ...row,
      essentialPoints: row.essentialPoints ?? [],
      misconceptions: row.misconceptions ?? [],
    }));
}

export type PaperRequest = PaperScope & {
  questionCount?: number;
  durationMinutes?: number | null;
  typedShare?: number;
  seed?: number;
  /** Rewritten prompts by card id; anything missing keeps its own wording. */
  rephrased?: Map<string, string>;
  /** How hard typed answers on this paper are marked. */
  strictness?: string | null;
  /**
   * Wrong options written for each question by card id (`writeOptions`);
   * anything missing takes its options from the deck.
   */
  written?: Map<string, string[]>;
};

export function createPaper(
  db: Db,
  examId: string,
  request: PaperRequest = {},
): PracticeExam | undefined {
  const cards = loadPaperCards(db, examId);
  const selected = selectCards(cards, {
    questionCount: request.questionCount ?? DEFAULT_QUESTION_COUNT,
    sources: request.sources,
    ranges: request.ranges,
    topics: request.topics,
    cardIds: request.cardIds,
    seed: request.seed,
  });

  if (selected.length === 0) return undefined;

  const drafts = interleave(
    assignFormats(selected, request.typedShare ?? DEFAULT_TYPED_SHARE, request.seed).map(
      (draft) => ({ ...draft, topic: draft.card.topic }),
    ),
    request.seed,
  );

  const rephrased = request.rephrased ?? new Map<string, string>();

  const paper = db
    .insert(practiceExams)
    .values({
      examId,
      topics: request.topics ?? [],
      durationMinutes: request.durationMinutes ?? null,
      questionCount: drafts.length,
      rephrased: rephrased.size > 0,
      strictness: request.strictness ?? null,
    })
    .returning()
    .get();

  const mcqDeck = cards.map((card) => ({
    id: card.id,
    topic: card.topic,
    question: card.question,
    directAnswer: card.directAnswer,
    misconceptions: card.misconceptions,
  }));

  const built = drafts.map(({ card, format }, position) =>
    format === "mcq"
      ? buildMcq(
          {
            id: card.id,
            topic: card.topic,
            question: card.question,
            directAnswer: card.directAnswer,
            misconceptions: card.misconceptions,
          },
          mcqDeck,
          {
            seed: request.seed === undefined ? undefined : request.seed + position,
            written: request.written?.get(card.id),
          },
        )
      : [],
  );

  // Dealt across the whole paper so the right answer is spread evenly over
  // A–D. The per-question seed used to be the question's position, which put
  // the answer in the same slots on every paper — mostly the bottom two.
  const slots = dealPositions(
    built.map((options) => options.length),
    request.seed,
  );

  db.transaction((tx) => {
    drafts.forEach((draft, position) => {
      const { card, format } = draft;
      const options = placeCorrect(built[position], slots[position]);

      tx.insert(practiceQuestions)
        .values({
          practiceExamId: paper.id,
          flashcardId: card.id,
          position,
          format,
          prompt: rephrased.get(card.id) ?? card.question,
          options: options.map((option) => option.text),
          correctOption:
            options.find((option) => option.correct)?.text ?? null,
          expectedAnswer: card.directAnswer,
          essentialPoints: card.essentialPoints,
        })
        .run();
    });
  });

  return paper;
}

export function activePaper(db: Db, examId: string): PracticeExam | undefined {
  return db
    .select()
    .from(practiceExams)
    .where(
      and(eq(practiceExams.examId, examId), eq(practiceExams.status, "sitting")),
    )
    .orderBy(desc(practiceExams.startedAt))
    .get();
}

export function latestPaper(db: Db, examId: string): PracticeExam | undefined {
  return db
    .select()
    .from(practiceExams)
    .where(eq(practiceExams.examId, examId))
    .orderBy(desc(practiceExams.startedAt))
    .get();
}

export function paperQuestions(db: Db, paperId: string) {
  return db
    .select()
    .from(practiceQuestions)
    .where(eq(practiceQuestions.practiceExamId, paperId))
    .orderBy(asc(practiceQuestions.position))
    .all();
}

/** Records an answer. Deliberately returns nothing about whether it is right. */
export function saveAnswer(db: Db, questionId: string, answer: string) {
  db.update(practiceQuestions)
    .set({ answer })
    .where(eq(practiceQuestions.id, questionId))
    .run();
}

/** Whether a timed paper's time is up. */
export function timeRemaining(
  paper: PracticeExam,
  now: number = Date.now(),
): number | null {
  if (!paper.durationMinutes) return null;

  const started = Date.parse(paper.startedAt);
  if (!Number.isFinite(started)) return null;

  return Math.max(0, started + paper.durationMinutes * 60_000 - now);
}

export type Marked = {
  score: number;
  total: number;
  questions: number;
};

/**
 * Marks the paper.
 *
 * Multiple choice is marked without a model — the correct option is known.
 * Typed answers go through the same grader the Learn mode uses, so an exam
 * marks meaning the same way practice does rather than by string comparison.
 */
export async function submitPaper(
  db: Db,
  paperId: string,
  grader: TypedAnswerGrader,
): Promise<Marked | undefined> {
  const paper = db
    .select()
    .from(practiceExams)
    .where(eq(practiceExams.id, paperId))
    .get();

  if (!paper || paper.status !== "sitting") return undefined;

  // Claimed before any marking: the timer and the Submit button can both fire,
  // and only the first may mark the paper and record its misses.
  const claimed = db
    .update(practiceExams)
    .set({ submittedAt: new Date().toISOString() })
    .where(
      and(
        eq(practiceExams.id, paperId),
        eq(practiceExams.status, "sitting"),
        isNull(practiceExams.submittedAt),
      ),
    )
    .run();
  if (claimed.changes === 0) return undefined;

  try {
    return await markPaper(db, paperId, grader);
  } catch (error) {
    // Marking failed part way: free the paper so Submit can be pressed again.
    db.update(practiceExams)
      .set({ submittedAt: null })
      .where(eq(practiceExams.id, paperId))
      .run();
    throw error;
  }
}

async function markPaper(
  db: Db,
  paperId: string,
  grader: TypedAnswerGrader,
): Promise<Marked> {
  const questions = paperQuestions(db, paperId);
  let score = 0;

  for (const question of questions) {
    const answer = (question.answer ?? "").trim();

    if (question.format === "mcq") {
      const correct = answer !== "" && answer === question.correctOption;
      if (correct) score += 1;

      db.update(practiceQuestions)
        .set({
          verdict: correct ? "correct" : "incorrect",
          // A wrong option says nothing about why; the feedback names the choice.
          errorType: correct || answer !== "" ? "none" : "unrelated",
          missedPoints: correct ? [] : question.essentialPoints,
          feedback: correct
            ? "Correct."
            : answer === ""
              ? "Left blank."
              : `You chose "${answer}".`,
        })
        .where(eq(practiceQuestions.id, question.id))
        .run();

      continue;
    }

    if (answer === "") {
      db.update(practiceQuestions)
        .set({
          verdict: "incorrect",
          errorType: "unrelated",
          missedPoints: question.essentialPoints,
          feedback: "Left blank.",
        })
        .where(eq(practiceQuestions.id, question.id))
        .run();
      continue;
    }

    const grade = await grader.grade({
      question: question.prompt,
      expected: question.expectedAnswer,
      essentialPoints: question.essentialPoints,
      answer,
    });

    if (grade.verdict === "correct") score += 1;

    db.update(practiceQuestions)
      .set({
        verdict: grade.verdict,
        errorType: grade.errorType,
        missedPoints: grade.missedPoints,
        feedback: grade.feedback,
      })
      .where(eq(practiceQuestions.id, question.id))
      .run();
  }

  recordMisses(db, paperId);

  db.update(practiceExams)
    .set({
      status: "submitted",
      score,
      submittedAt: new Date().toISOString(),
    })
    .where(eq(practiceExams.id, paperId))
    .run();

  return { score, total: questions.length, questions: questions.length };
}

/**
 * Carries a paper's misses back into study, so the cards behind them turn up
 * under "Missed" in Flashcards and Learn.
 *
 * Only as a flip-card miss would: a lapse and the grade, never a demotion or
 * a change to the schedule — one wrong answer on a paper is not evidence that
 * multi-day retention is gone. A right answer changes nothing, because an
 * exam measures and is not where credit is earned.
 */
function recordMisses(db: Db, paperId: string) {
  const now = new Date().toISOString();
  const missed = paperQuestions(db, paperId).filter(
    (question) => question.flashcardId && question.verdict !== "correct",
  );

  for (const cardId of new Set(missed.map((question) => question.flashcardId!))) {
    const current = db
      .select({ lapses: studyProgress.lapses })
      .from(studyProgress)
      .where(eq(studyProgress.flashcardId, cardId))
      .get();

    if (current) {
      db.update(studyProgress)
        .set({ lapses: current.lapses + 1, lastGrade: "missed", lastReviewedAt: now })
        .where(eq(studyProgress.flashcardId, cardId))
        .run();
    } else {
      db.insert(studyProgress)
        .values({ flashcardId: cardId, lapses: 1, lastGrade: "missed", lastReviewedAt: now })
        .run();
    }
  }
}

export function abandonPaper(db: Db, paperId: string) {
  db.update(practiceExams)
    .set({ status: "abandoned", submittedAt: new Date().toISOString() })
    .where(eq(practiceExams.id, paperId))
    .run();
}

/**
 * The post-exam diagnostic: every error, traced back to its slide.
 *
 * PRD §11 asks for errors linked to source material, which is the difference
 * between "you got this wrong" and "here is the page to reread".
 */
export function diagnostic(db: Db, paperId: string) {
  const rows = db
    .select({
      question: practiceQuestions,
      slideIndex: sourceSlides.index,
      slideTitle: sourceSlides.title,
      excerpt: flashcards.sourceExcerpt,
      filename: sourceFiles.filename,
      fileType: sourceFiles.fileType,
      topic: flashcards.topic,
    })
    .from(practiceQuestions)
    .leftJoin(flashcards, eq(flashcards.id, practiceQuestions.flashcardId))
    .leftJoin(sourceSlides, eq(sourceSlides.id, flashcards.sourceSlideId))
    .leftJoin(sourceFiles, eq(sourceFiles.id, sourceSlides.sourceFileId))
    .where(eq(practiceQuestions.practiceExamId, paperId))
    .orderBy(asc(practiceQuestions.position))
    .all();

  return rows.map((row) => ({
    ...row.question,
    topic: row.topic,
    source:
      row.slideIndex === null
        ? null
        : {
            label: `${
              row.fileType === "pptx"
                ? "Slide"
                : row.fileType === "pdf"
                  ? "Page"
                  : "Section"
            } ${row.slideIndex} of ${row.filename ?? "your material"}`,
            title: row.slideTitle,
            excerpt: row.excerpt,
          },
  }));
}

/** The multiple-choice questions of a paper still being sat, as `writeOptions` takes them. */
export function paperOptionInputs(db: Db, paperId: string) {
  const paper = db.select().from(practiceExams).where(eq(practiceExams.id, paperId)).get();
  if (!paper || paper.status !== "sitting") return [];

  const misconceptions = new Map(
    loadPaperCards(db, paper.examId).map((card) => [card.id, card.misconceptions]),
  );

  return paperQuestions(db, paperId)
    .filter((question) => question.format === "mcq" && question.correctOption)
    .map((question) => ({
      // Keyed by question, not card: the options belong to this question.
      id: question.id,
      question: question.prompt,
      answer: question.correctOption as string,
      misconceptions: misconceptions.get(question.flashcardId ?? "") ?? [],
    }));
}

/**
 * Replaces the wrong options on a paper being sat, keeping its questions.
 *
 * For a paper set before options were written for it. Only questions that got
 * written options change; an answer already given is kept only if it is still
 * one of the options (the right answer always is).
 */
export function replaceOptions(
  db: Db,
  paperId: string,
  written: Map<string, string[]>,
  seed = Math.floor(Math.random() * 2 ** 31),
): number {
  const questions = paperQuestions(db, paperId).filter(
    (question) => question.format === "mcq" && question.correctOption && written.has(question.id),
  );

  const built = questions.map((question) =>
    buildMcq(
      {
        id: question.id,
        topic: "",
        question: question.prompt,
        directAnswer: question.correctOption as string,
        misconceptions: [],
      },
      [],
      { seed: seed + question.position, written: written.get(question.id) },
    ),
  );
  const slots = dealPositions(
    built.map((options) => options.length),
    seed,
  );

  db.transaction((tx) => {
    questions.forEach((question, i) => {
      const placed = placeCorrect(built[i], slots[i]);
      const options = placed.map((option) => option.text);
      tx.update(practiceQuestions)
        .set({
          options,
          correctOption: placed.find((option) => option.correct)?.text ?? question.correctOption,
          answer: question.answer && options.includes(question.answer) ? question.answer : null,
        })
        .where(eq(practiceQuestions.id, question.id))
        .run();
    });
  });

  return questions.length;
}

/** Marked papers, newest first, for the history list and the score trend. */
export function paperHistory(db: Db, examId: string, limit = 12) {
  return db
    .select({
      id: practiceExams.id,
      score: practiceExams.score,
      questionCount: practiceExams.questionCount,
      topics: practiceExams.topics,
      strictness: practiceExams.strictness,
      submittedAt: practiceExams.submittedAt,
      startedAt: practiceExams.startedAt,
    })
    .from(practiceExams)
    .where(
      and(eq(practiceExams.examId, examId), eq(practiceExams.status, "submitted")),
    )
    .orderBy(desc(practiceExams.startedAt))
    .limit(limit)
    .all();
}
