/**
 * In-session scaffolding and remediation (PRD §14).
 *
 * Two jobs: produce help that is grounded in the student's own material, and
 * make sure using it is recorded — because an answer given after a hint is
 * assisted practice, and counting it as recall would inflate exactly the
 * number the rest of this app works to keep honest.
 */
import { and, desc, eq, ne } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  answerAttempts,
  assistEvents,
  cardRubrics,
  errorDiagnoses,
  flashcards,
  sourceFiles,
  sourceSlides,
  type AssistEvent,
  type ErrorDiagnosis,
} from "@/db/schema";
import type { LlmProvider } from "@/lib/llm";

import {
  ASSIST_SYSTEM,
  assistPrompt,
  DIAGNOSIS_SYSTEM,
  diagnosisPrompt,
  type AssistContext,
} from "./prompts";
import {
  ASSIST_SCHEMA,
  DIAGNOSIS_SCHEMA,
  type AssistKind,
  type AssistResponse,
  type DiagnosisResponse,
} from "./schemas";

export * from "./schemas";

/** Wrong answers needed before diagnosing a pattern rather than a bad day. */
export const DIAGNOSIS_THRESHOLD = 2;

const STOPWORDS = new Set(
  `a an and are as at be by for from in into is it its of on or that the their
   this to was were with`
    .split(/\s+/)
    .filter(Boolean),
);

function contentWords(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/**
 * True when a "hint" has told the student the answer.
 *
 * A hint that contains a required point is not a hint, and the model cannot be
 * relied on to feel the difference — so it is checked here, the same way
 * provenance and grading gates are.
 */
export function hintLeaksAnswer(
  hint: string,
  essentialPoints: string[],
  directAnswer: string,
): boolean {
  const given = new Set(contentWords(hint));

  const leaks = (target: string) => {
    const required = contentWords(target);
    if (required.length === 0) return false;
    const hits = required.filter((word) => given.has(word)).length;
    return hits / required.length >= 0.8;
  };

  return essentialPoints.some(leaks) || leaks(directAnswer);
}

/**
 * A hint that cannot leak, because it is built from the shape of the answer
 * rather than its content.
 */
export function structuralHint(
  pointCount: number,
  sourceLabel?: string | null,
): string {
  const shape =
    pointCount > 1
      ? `This answer needs ${pointCount} separate points, so a single phrase will not be enough — work out what the question is asking for in parts.`
      : "This answer is one specific thing, not a general description — try to name it exactly.";

  return sourceLabel
    ? `${shape} It came from ${sourceLabel}, if you want to look it up instead.`
    : shape;
}

export type AssistRequest = {
  cardId: string;
  kind: AssistKind;
  sessionId?: string | null;
};

function loadContext(db: Db, cardId: string) {
  const row = db
    .select({
      card: flashcards,
      rubric: cardRubrics,
      slide: sourceSlides,
      file: sourceFiles,
    })
    .from(flashcards)
    .leftJoin(cardRubrics, eq(cardRubrics.flashcardId, flashcards.id))
    .leftJoin(sourceSlides, eq(sourceSlides.id, flashcards.sourceSlideId))
    .leftJoin(sourceFiles, eq(sourceFiles.id, sourceSlides.sourceFileId))
    .where(eq(flashcards.id, cardId))
    .get();

  if (!row) return undefined;

  const siblings = row.card.topic
    ? db
        .select({
          question: flashcards.question,
          directAnswer: flashcards.directAnswer,
        })
        .from(flashcards)
        .where(
          and(
            eq(flashcards.examId, row.card.examId),
            eq(flashcards.topic, row.card.topic),
            ne(flashcards.id, cardId),
          ),
        )
        .all()
        .slice(0, 8)
    : [];

  const sourceLabel = row.slide
    ? `${row.file?.fileType === "pptx" ? "slide" : row.file?.fileType === "docx" ? "section" : "page"} ${row.slide.index} of ${row.file?.filename ?? "your notes"}`
    : null;

  const context: AssistContext = {
    question: row.card.question,
    directAnswer: row.card.directAnswer,
    fullExplanation: row.card.fullExplanation,
    essentialPoints: row.rubric?.essentialPoints ?? [],
    sourceExcerpt: row.card.sourceExcerpt,
    sourceText: row.slide?.rawText ?? null,
    siblings,
  };

  return { context, sourceLabel, card: row.card };
}

export async function requestAssist(
  db: Db,
  llm: LlmProvider,
  request: AssistRequest,
): Promise<AssistEvent | undefined> {
  const loaded = loadContext(db, request.cardId);
  if (!loaded) return undefined;

  const { context, sourceLabel } = loaded;

  // "Show the slide" needs no model: the material is already here.
  if (request.kind === "source") {
    const body = context.sourceExcerpt
      ? `From ${sourceLabel ?? "your material"}:\n\n"${context.sourceExcerpt}"`
      : (context.sourceText ?? "This card has no linked source.");

    return record(db, request, body, false);
  }

  const { data } = await llm.generateStructured<AssistResponse>({
    system: ASSIST_SYSTEM,
    prompt: assistPrompt(request.kind, context),
    schema: ASSIST_SCHEMA,
    temperature: 0.2,
    // Reading an answer off material already in the prompt: thinking first
    // was most of the cost and none of the quality (see Phase 23 in TASKS.md).
    thinking: "minimal",
  });

  let body = data.body?.trim() || "No help could be generated for this card.";
  let outside = Boolean(data.usesOutsideKnowledge);

  if (
    request.kind === "hint" &&
    hintLeaksAnswer(body, context.essentialPoints, context.directAnswer)
  ) {
    // The model wrote the answer out. Replace it rather than show it.
    body = structuralHint(
      Math.max(context.essentialPoints.length, 1),
      sourceLabel,
    );
    outside = false;
  }

  return record(db, request, body, outside);
}

function record(
  db: Db,
  request: AssistRequest,
  body: string,
  usesOutsideKnowledge: boolean,
): AssistEvent {
  return db
    .insert(assistEvents)
    .values({
      flashcardId: request.cardId,
      sessionId: request.sessionId ?? null,
      kind: request.kind,
      body,
      usesOutsideKnowledge,
    })
    .returning()
    .get();
}

/** Aids used for this card during this session, so the UI can show them again. */
export function assistsForCard(
  db: Db,
  cardId: string,
  sessionId?: string | null,
): AssistEvent[] {
  return db
    .select()
    .from(assistEvents)
    .where(
      sessionId
        ? and(
            eq(assistEvents.flashcardId, cardId),
            eq(assistEvents.sessionId, sessionId),
          )
        : eq(assistEvents.flashcardId, cardId),
    )
    .orderBy(assistEvents.createdAt)
    .all();
}

/* ------------------------------------------------------------- Diagnosis */

/** The wrong answers a diagnosis would be based on, oldest first. */
export function wrongAnswers(db: Db, cardId: string): string[] {
  return db
    .select()
    .from(answerAttempts)
    .where(eq(answerAttempts.flashcardId, cardId))
    .orderBy(answerAttempts.createdAt)
    .all()
    .filter(
      (attempt) =>
        !attempt.practice &&
        !attempt.overridden &&
        attempt.verdict !== "correct" &&
        attempt.answer.trim().length > 0,
    )
    .map((attempt) => attempt.answer);
}

export function existingDiagnosis(
  db: Db,
  cardId: string,
): ErrorDiagnosis | undefined {
  return db
    .select()
    .from(errorDiagnoses)
    .where(eq(errorDiagnoses.flashcardId, cardId))
    .get();
}

/**
 * Works out why a card keeps being missed, from what the student wrote.
 *
 * Re-runs only when there are new wrong answers to look at, so repeatedly
 * opening the panel does not repeatedly pay for the same conclusion.
 */
export async function diagnoseCard(
  db: Db,
  llm: LlmProvider,
  cardId: string,
): Promise<ErrorDiagnosis | undefined> {
  const answers = wrongAnswers(db, cardId);
  if (answers.length < DIAGNOSIS_THRESHOLD) return undefined;

  const existing = existingDiagnosis(db, cardId);
  if (existing && existing.attemptsConsidered >= answers.length) return existing;

  const loaded = loadContext(db, cardId);
  if (!loaded) return undefined;

  const { data } = await llm.generateStructured<DiagnosisResponse>({
    system: DIAGNOSIS_SYSTEM,
    prompt: diagnosisPrompt({ ...loaded.context, answers }),
    schema: DIAGNOSIS_SCHEMA,
    temperature: 0,
  });

  const values = {
    flashcardId: cardId,
    category: data.category,
    explanation: data.explanation?.trim() || "",
    suggestion: data.suggestion?.trim() || "",
    attemptsConsidered: answers.length,
    createdAt: new Date().toISOString(),
  };

  if (existing) {
    return db
      .update(errorDiagnoses)
      .set(values)
      .where(eq(errorDiagnoses.id, existing.id))
      .returning()
      .get();
  }

  return db.insert(errorDiagnoses).values(values).returning().get();
}

/** Most recently diagnosed cards, for the remediation view. */
export function listDiagnoses(db: Db, examId: string) {
  return db
    .select({ diagnosis: errorDiagnoses, card: flashcards })
    .from(errorDiagnoses)
    .innerJoin(flashcards, eq(flashcards.id, errorDiagnoses.flashcardId))
    .where(eq(flashcards.examId, examId))
    .orderBy(desc(errorDiagnoses.createdAt))
    .all();
}
