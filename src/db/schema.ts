/**
 * Database schema — mirrors the model guidelines in docs/ARCHITECTURE.md.
 *
 * Conventions:
 *  - Table/column names are snake_case; exported Drizzle objects are camelCase.
 *  - Primary keys are UUID strings so records can be generated client- or
 *    worker-side and merged non-destructively on re-ingestion.
 *  - Booleans are stored as SQLite integers via `{ mode: "boolean" }`.
 *  - Timestamps are ISO-8601 strings, which keeps them portable to Turso.
 */
import { relations, sql } from "drizzle-orm";
// Type-only: the Learn round engine owns the shape of its own saved state.
import type { RoundState } from "@/lib/learn/ladder";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`);

/* ------------------------------------------------------------------ Course */

export const courses = sqliteTable("courses", {
  id: id(),
  title: text("title").notNull(),
  term: text("term"),
  createdAt: createdAt(),
});

/* -------------------------------------------------------------------- Exam */

export const exams = sqliteTable(
  "exams",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** ISO date (YYYY-MM-DD) of the exam, used later for load planning. */
    date: text("date"),
    /**
     * "files"      — generate cards for everything in the uploaded material.
     * "objectives" — constrain generation strictly to study-guide objectives.
     */
    scopeMode: text("scope_mode", { enum: ["files", "objectives"] })
      .notNull()
      .default("files"),
    /**
     * Whether generation also produces higher-order application cards
     * (PRD §9). Off by default: they are worth more once the underlying
     * facts are in the deck.
     */
    includeApplication: integer("include_application", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: createdAt(),
  },
  (t) => [index("exams_course_idx").on(t.courseId)],
);

/* -------------------------------------------------------------- SourceFile */

export const sourceFileTypes = [
  "pdf",
  "pptx",
  "docx",
  "txt",
  "md",
  "rtf",
  "csv",
  /** Text pasted straight into the app rather than uploaded. */
  "pasted",
  "image",
] as const;
export const sourceFileRoles = ["slides", "study_guide", "notes"] as const;
export const ingestStatuses = [
  "pending",
  "extracting",
  "ready",
  "failed",
] as const;

export const sourceFiles = sqliteTable(
  "source_files",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    fileType: text("file_type", { enum: sourceFileTypes }).notNull(),
    /** How this file is used by the pipeline (outline vs. answer source). */
    role: text("role", { enum: sourceFileRoles }).notNull().default("slides"),
    /** Path on disk, relative to the uploads root. */
    rawPath: text("raw_path").notNull(),
    sizeBytes: integer("size_bytes"),
    /** SHA-256 of the upload; lets re-ingestion detect an unchanged file. */
    checksum: text("checksum"),
    status: text("status", { enum: ingestStatuses }).notNull().default("pending"),
    errorMessage: text("error_message"),
    unitCount: integer("unit_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("source_files_exam_idx").on(t.examId)],
);

/* ------------------------------------------------------- SourceSlideOrPage */

/**
 * One slide (PPTX) or page (PDF) of a source file — the provenance anchor
 * every flashcard must point at.
 */
export const sourceSlides = sqliteTable(
  "source_slides",
  {
    id: id(),
    sourceFileId: text("source_file_id")
      .notNull()
      .references(() => sourceFiles.id, { onDelete: "cascade" }),
    /** 1-based slide/page number as the student sees it in the original file. */
    index: integer("index").notNull(),
    title: text("title"),
    rawText: text("raw_text").notNull().default(""),
    speakerNotes: text("speaker_notes"),
    /** Extracted tables, each as `{ rows: string[][] }`. */
    tables: text("tables", { mode: "json" })
      .$type<{ rows: string[][] }[]>()
      .notNull()
      .default([]),
    imagePath: text("image_path"),
    hasDiagram: integer("has_diagram", { mode: "boolean" })
      .notNull()
      .default(false),
    /**
     * Set when a unit is image-only, empty, or otherwise likely unreadable —
     * surfaced as a legibility flag (PRD §3).
     */
    legibilityFlag: text("legibility_flag", {
      enum: ["ok", "empty", "image_only", "low_text"],
    })
      .notNull()
      .default("ok"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("source_slides_file_index_idx").on(t.sourceFileId, t.index),
  ],
);

/* ------------------------------------------------- StudyGuideObjective */

export const studyGuideObjectives = sqliteTable(
  "study_guide_objectives",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    sourceFileId: text("source_file_id").references(() => sourceFiles.id, {
      onDelete: "set null",
    }),
    /** Order within the study guide, for stable checklist display. */
    orderIndex: integer("order_index").notNull().default(0),
    /** Optional label from the guide, e.g. "Question 7". */
    label: text("label"),
    promptText: text("prompt_text").notNull(),
    professorEmphasis: integer("professor_emphasis", { mode: "boolean" })
      .notNull()
      .default(false),
    excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("objectives_exam_idx").on(t.examId)],
);

/* --------------------------------------------------------------- Flashcard */

export const cardTypes = [
  "atomic",
  "process",
  "integration",
  /** Higher-order questions (PRD §9): perturbations, shifts, scenarios. */
  "application",
] as const;

export const flashcards = sqliteTable(
  "flashcards",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    topic: text("topic"),
    question: text("question").notNull(),
    /** Concise answer shown on flip. */
    directAnswer: text("direct_answer").notNull(),
    /** Expandable detail; may contain AI-supplemental context. */
    fullExplanation: text("full_explanation"),
    cardType: text("card_type", { enum: cardTypes }).notNull().default("atomic"),
    /** Provenance (ARCHITECTURE principle #1) — required for generated cards. */
    sourceSlideId: text("source_slide_id").references(() => sourceSlides.id, {
      onDelete: "set null",
    }),
    /** Verbatim supporting text copied from the source unit. */
    sourceExcerpt: text("source_excerpt"),
    /** True when `full_explanation` goes beyond the source material. */
    hasAiSupplement: integer("has_ai_supplement", { mode: "boolean" })
      .notNull()
      .default(false),
    isUserEdited: integer("is_user_edited", { mode: "boolean" })
      .notNull()
      .default(false),
    professorEmphasis: integer("professor_emphasis", { mode: "boolean" })
      .notNull()
      .default(false),
    starred: integer("starred", { mode: "boolean" }).notNull().default(false),
    excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [
    index("flashcards_exam_idx").on(t.examId),
    index("flashcards_source_idx").on(t.sourceSlideId),
  ],
);

/* -------------------------------------------------------------- CardRubric */

export const cardRubrics = sqliteTable(
  "card_rubrics",
  {
    id: id(),
    flashcardId: text("flashcard_id")
      .notNull()
      .references(() => flashcards.id, { onDelete: "cascade" }),
    /** Mandatory points a typed answer must hit to count as correct. */
    essentialPoints: text("essential_points", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    /** Peripheral context — credited but not required. */
    optionalPoints: text("optional_points", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    commonMisconceptions: text("common_misconceptions", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
  },
  (t) => [uniqueIndex("card_rubrics_card_idx").on(t.flashcardId)],
);

/* --------------------------------------------------------- CoverageMapping */

export const coverageStatuses = [
  "covered",
  "partially_covered",
  "missing",
] as const;

export const coverageMappings = sqliteTable(
  "coverage_mappings",
  {
    id: id(),
    objectiveId: text("objective_id")
      .notNull()
      .references(() => studyGuideObjectives.id, { onDelete: "cascade" }),
    /** Null when the objective has no supporting card yet (a detected gap). */
    flashcardId: text("flashcard_id").references(() => flashcards.id, {
      onDelete: "cascade",
    }),
    status: text("status", { enum: coverageStatuses }).notNull(),
    /** Why the mapper assigned this status; shown in the coverage matrix. */
    rationale: text("rationale"),
    createdAt: createdAt(),
  },
  (t) => [
    index("coverage_objective_idx").on(t.objectiveId),
    uniqueIndex("coverage_pair_idx").on(t.objectiveId, t.flashcardId),
  ],
);

/* ------------------------------------------------------ ObjectiveCoverage */

export const sourceSupportLevels = ["answers", "partial", "silent"] as const;

/**
 * The per-objective verdict for the coverage matrix (PRD §3).
 *
 * `coverage_mappings` records WHICH cards support an objective; this records
 * whether, taken together, they actually answer it — and when they do not,
 * whether the uploaded material even could. "We failed to make the card" and
 * "your files never cover this" are different problems for the student, and
 * the checklist is only useful if it tells them apart.
 */
export const objectiveCoverage = sqliteTable(
  "objective_coverage",
  {
    id: id(),
    objectiveId: text("objective_id")
      .notNull()
      .references(() => studyGuideObjectives.id, { onDelete: "cascade" }),
    status: text("status", { enum: coverageStatuses }).notNull(),
    rationale: text("rationale"),
    /** Sub-points the objective asks for that no card answers. */
    missingPoints: text("missing_points", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    /** Secondary review pass: does the source material support this at all? */
    sourceSupport: text("source_support", { enum: sourceSupportLevels }),
    /** Where the review found supporting material, when it found any. */
    supportingSlideId: text("supporting_slide_id").references(
      () => sourceSlides.id,
      { onDelete: "set null" },
    ),
    supportingExcerpt: text("supporting_excerpt"),
    reviewedAt: text("reviewed_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (t) => [uniqueIndex("objective_coverage_objective_idx").on(t.objectiveId)],
);

/* -------------------------------------------------------- ContentConflict */

/**
 * Contradicting statements found across files (PRD §3). Stored rather than
 * resolved: the app flags both sides and lets the student decide, because
 * silently picking one is how a wrong answer becomes invisible.
 */
export const contentConflicts = sqliteTable(
  "content_conflicts",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    topic: text("topic"),
    statementA: text("statement_a").notNull(),
    slideAId: text("slide_a_id").references(() => sourceSlides.id, {
      onDelete: "cascade",
    }),
    statementB: text("statement_b").notNull(),
    slideBId: text("slide_b_id").references(() => sourceSlides.id, {
      onDelete: "cascade",
    }),
    /** Why the two statements cannot both be true. */
    explanation: text("explanation").notNull(),
    /** Set only by the student; the pipeline never resolves a conflict. */
    resolution: text("resolution"),
    dismissed: integer("dismissed", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: createdAt(),
  },
  (t) => [index("content_conflicts_exam_idx").on(t.examId)],
);

/* ----------------------------------------------------------- StudyProgress */

export const progressStates = [
  "unstudied",
  "recognition",
  "immediate_recall",
  "retained",
] as const;

export const grades = ["missed", "difficult", "easy"] as const;

export const studyProgress = sqliteTable(
  "study_progress",
  {
    id: id(),
    flashcardId: text("flashcard_id")
      .notNull()
      .references(() => flashcards.id, { onDelete: "cascade" }),
    state: text("state", { enum: progressStates }).notNull().default("unstudied"),
    intervalDays: integer("interval_days").notNull().default(0),
    /**
     * Due DATE (YYYY-MM-DD); null means "not yet scheduled". A date rather
     * than a timestamp so "due today" survives time zones, and so a card that
     * is late is simply due rather than late by some number of hours.
     */
    nextReviewDue: text("next_review_due"),
    /** Per-card difficulty multiplier (PRD §6: intervals adapt to the card). */
    ease: real("ease").notNull().default(2.3),
    /**
     * Date of the last review that counted toward the schedule. Separate from
     * `last_reviewed_at`, which moves for practice too — only this one decides
     * whether a success is new evidence or the same day's again.
     */
    lastCreditedAt: text("last_credited_at"),
    lastGrade: text("last_grade", { enum: grades }),
    lastReviewedAt: text("last_reviewed_at"),
    /** Separate tracking axes required by PRD §6. */
    recognitionCount: integer("recognition_count").notNull().default(0),
    immediateRecallCount: integer("immediate_recall_count").notNull().default(0),
    retentionCount: integer("retention_count").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    /** Sub-points already mastered, so a partial miss does not reset credit. */
    masteredPoints: text("mastered_points", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
  },
  (t) => [
    uniqueIndex("study_progress_card_idx").on(t.flashcardId),
    index("study_progress_due_idx").on(t.nextReviewDue),
  ],
);

/* ------------------------------------------------------------ StudySession */

export const sessionScopes = [
  "all",
  "topic",
  "starred",
  "missed",
  "due",
] as const;

/**
 * One run through a deck, kept so a session resumes exactly (PRD §4).
 *
 * The queue is stored as an ordered list of card ids rather than recomputed
 * from a filter: a shuffled deck, or a deck whose cards were graded mid-run,
 * would otherwise come back in a different order and silently lose the
 * student's place.
 */
export const studySessions = sqliteTable(
  "study_sessions",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    mode: text("mode", { enum: ["flashcards", "learn"] })
      .notNull()
      .default("flashcards"),
    scope: text("scope", { enum: sessionScopes }).notNull().default("all"),
    /** Set when scope is "topic". */
    topic: text("topic"),
    shuffled: integer("shuffled", { mode: "boolean" }).notNull().default(false),
    /** Card ids in the exact order they are being studied. */
    cardOrder: text("card_order", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    /** Index into `card_order` of the card to show next. */
    position: integer("position").notNull().default(0),
    /** Concepts per Learn micro-round (PRD §5: 5–8, user-configurable). */
    roundSize: integer("round_size").notNull().default(6),
    /** Index into `card_order` of the current round's first concept. */
    roundIndex: integer("round_index").notNull().default(0),
    /** The Learn engine's state for the round in progress; null in flashcards mode. */
    roundState: text("round_state", { mode: "json" }).$type<RoundState>(),
    /**
     * The round state as it was before the last answer, so a student who
     * overrides a grade ("my answer was correct") resumes the ladder as if
     * they had been right, instead of being re-asked something they knew.
     */
    previousRoundState: text("previous_round_state", {
      mode: "json",
    }).$type<RoundState>(),
    missedCount: integer("missed_count").notNull().default(0),
    difficultCount: integer("difficult_count").notNull().default(0),
    easyCount: integer("easy_count").notNull().default(0),
    startedAt: createdAt(),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    /** Null while the session is still open. */
    completedAt: text("completed_at"),
  },
  (t) => [index("study_sessions_exam_idx").on(t.examId)],
);

/* ----------------------------------------------------------- AnswerAttempt */

export const verdicts = ["correct", "partial", "incorrect"] as const;

/**
 * Every typed answer, kept verbatim (PRD §7, §13).
 *
 * Grades are a judgement about the student's words, so the words have to
 * survive the judgement: it is what makes "my answer was correct" reviewable,
 * what feeds practising the specific sub-points that were missed, and what a
 * grading regression is measured against.
 */
export const answerAttempts = sqliteTable(
  "answer_attempts",
  {
    id: id(),
    flashcardId: text("flashcard_id")
      .notNull()
      .references(() => flashcards.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => studySessions.id, {
      onDelete: "set null",
    }),
    /** Which rung of the Learn ladder produced it; null outside Learn. */
    stage: text("stage"),
    answer: text("answer").notNull(),
    verdict: text("verdict", { enum: verdicts }).notNull(),
    errorType: text("error_type"),
    metPoints: text("met_points", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    missedPoints: text("missed_points", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    /** Whether this attempt was eligible to prove recall when it was made. */
    countsTowardMastery: integer("counts_toward_mastery", { mode: "boolean" })
      .notNull()
      .default(false),
    guessed: integer("guessed", { mode: "boolean" }).notNull().default(false),
    /** A sub-point drill: graded and recorded, but never scored. */
    practice: integer("practice", { mode: "boolean" }).notNull().default(false),
    /** The student used an aid before answering (PRD §14). */
    assisted: integer("assisted", { mode: "boolean" }).notNull().default(false),
    /** The student overruled the grade. */
    overridden: integer("overridden", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Graded by the keyword stand-in rather than the semantic grader. */
    provisional: integer("provisional", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("answer_attempts_card_idx").on(t.flashcardId),
    index("answer_attempts_session_idx").on(t.sessionId),
  ],
);

/* ------------------------------------------------------------ CardRevision */

/**
 * The previous text of a card, kept so an edit can be undone (PRD §15).
 *
 * Editing is continuous and autosaved, which without history means a student
 * can destroy a good card by typing into it. A revision is written before the
 * card is overwritten, so undo restores exactly what was there.
 */
export const cardRevisions = sqliteTable(
  "card_revisions",
  {
    id: id(),
    flashcardId: text("flashcard_id")
      .notNull()
      .references(() => flashcards.id, { onDelete: "cascade" }),
    /** The content as it was BEFORE the edit this row records. */
    question: text("question").notNull(),
    directAnswer: text("direct_answer").notNull(),
    fullExplanation: text("full_explanation"),
    /** False when the card was still exactly as generated. */
    wasUserEdited: integer("was_user_edited", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: createdAt(),
  },
  (t) => [index("card_revisions_card_idx").on(t.flashcardId)],
);

/* -------------------------------------------------------------- AssistEvent */

export const assistKinds = [
  "simpler",
  "example",
  "compare",
  "hint",
  "prerequisite",
  "source",
] as const;

/**
 * Every time the student asked for help (PRD §14).
 *
 * Recorded because help changes what an answer means: recalling something
 * after a hint is assisted practice, not independent recall. Keeping the
 * events also shows which concepts consistently need scaffolding.
 */
export const assistEvents = sqliteTable(
  "assist_events",
  {
    id: id(),
    flashcardId: text("flashcard_id")
      .notNull()
      .references(() => flashcards.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => studySessions.id, {
      onDelete: "set null",
    }),
    kind: text("kind", { enum: assistKinds }).notNull(),
    /** What the aid said, so it can be shown again without paying twice. */
    body: text("body").notNull(),
    /** True when the aid went beyond the uploaded material. */
    usesOutsideKnowledge: integer("uses_outside_knowledge", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("assist_events_card_idx").on(t.flashcardId),
    index("assist_events_session_idx").on(t.sessionId),
  ],
);

/* ----------------------------------------------------------- ErrorDiagnosis */

export const errorCategories = [
  "missing_prerequisite",
  "term_confusion",
  "defective_question",
  "not_learned_yet",
] as const;

/**
 * Why a concept keeps being missed (PRD §14).
 *
 * "You got this wrong again" is not useful. Whether the student is missing a
 * prerequisite, confusing two terms, or answering a badly worded question
 * calls for three different responses — and the third is the app's fault, not
 * theirs, which is why it is a category at all.
 */
export const errorDiagnoses = sqliteTable(
  "error_diagnoses",
  {
    id: id(),
    flashcardId: text("flashcard_id")
      .notNull()
      .references(() => flashcards.id, { onDelete: "cascade" }),
    category: text("category", { enum: errorCategories }).notNull(),
    explanation: text("explanation").notNull(),
    /** What to do about it, in one sentence. */
    suggestion: text("suggestion").notNull(),
    /** How many wrong answers this diagnosis was based on. */
    attemptsConsidered: integer("attempts_considered").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("error_diagnoses_card_idx").on(t.flashcardId)],
);

/* -------------------------------------------------------------- AppSettings */

/**
 * Local application settings, stored beside the data they configure.
 *
 * The packaged desktop app has no environment to read an API key from, so it
 * is kept here — in the user's own application-data directory, on their own
 * machine. It is never sent to the browser: the settings screen is told only
 * whether a key exists and its last four characters.
 */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

/* ------------------------------------------------------------ GenerationJob */

export const jobStatuses = ["running", "done", "failed"] as const;

/**
 * A generation run, tracked while it happens.
 *
 * Generation persists each batch as it finishes, which is why cards used to
 * keep appearing after the request that started them had seemingly ended: the
 * browser had stopped watching, not the work. Keeping the run's state here
 * means the UI can show real progress, survive navigating away, and say
 * authoritatively when it is actually done.
 */
export const generationJobs = sqliteTable(
  "generation_jobs",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    /** Where the cards land — different from `examId` for a separate deck. */
    targetExamId: text("target_exam_id"),
    status: text("status", { enum: jobStatuses }).notNull().default("running"),
    /** append | replace | separate */
    mode: text("mode").notNull().default("append"),
    batchIndex: integer("batch_index").notNull().default(0),
    batchCount: integer("batch_count").notNull().default(0),
    cardsCreated: integer("cards_created").notNull().default(0),
    cardsRejected: integer("cards_rejected").notNull().default(0),
    error: text("error"),
    /** The finished summary, for the panel to show when it completes. */
    summary: text("summary", { mode: "json" }).$type<unknown>(),
    startedAt: createdAt(),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    finishedAt: text("finished_at"),
  },
  (t) => [index("generation_jobs_exam_idx").on(t.examId)],
);

/* --------------------------------------------------------------- Relations */

export const coursesRelations = relations(courses, ({ many }) => ({
  exams: many(exams),
}));

export const examsRelations = relations(exams, ({ one, many }) => ({
  course: one(courses, {
    fields: [exams.courseId],
    references: [courses.id],
  }),
  sourceFiles: many(sourceFiles),
  objectives: many(studyGuideObjectives),
  flashcards: many(flashcards),
  sessions: many(studySessions),
}));

export const sourceFilesRelations = relations(sourceFiles, ({ one, many }) => ({
  exam: one(exams, { fields: [sourceFiles.examId], references: [exams.id] }),
  slides: many(sourceSlides),
}));

export const sourceSlidesRelations = relations(
  sourceSlides,
  ({ one, many }) => ({
    sourceFile: one(sourceFiles, {
      fields: [sourceSlides.sourceFileId],
      references: [sourceFiles.id],
    }),
    flashcards: many(flashcards),
  }),
);

export const objectivesRelations = relations(
  studyGuideObjectives,
  ({ one, many }) => ({
    exam: one(exams, {
      fields: [studyGuideObjectives.examId],
      references: [exams.id],
    }),
    coverage: many(coverageMappings),
    verdict: one(objectiveCoverage),
  }),
);

export const flashcardsRelations = relations(flashcards, ({ one, many }) => ({
  exam: one(exams, { fields: [flashcards.examId], references: [exams.id] }),
  sourceSlide: one(sourceSlides, {
    fields: [flashcards.sourceSlideId],
    references: [sourceSlides.id],
  }),
  rubric: one(cardRubrics),
  progress: one(studyProgress),
  coverage: many(coverageMappings),
  attempts: many(answerAttempts),
  revisions: many(cardRevisions),
  assists: many(assistEvents),
  diagnosis: one(errorDiagnoses),
}));

export const cardRevisionsRelations = relations(cardRevisions, ({ one }) => ({
  flashcard: one(flashcards, {
    fields: [cardRevisions.flashcardId],
    references: [flashcards.id],
  }),
}));

export const cardRubricsRelations = relations(cardRubrics, ({ one }) => ({
  flashcard: one(flashcards, {
    fields: [cardRubrics.flashcardId],
    references: [flashcards.id],
  }),
}));

export const coverageMappingsRelations = relations(
  coverageMappings,
  ({ one }) => ({
    objective: one(studyGuideObjectives, {
      fields: [coverageMappings.objectiveId],
      references: [studyGuideObjectives.id],
    }),
    flashcard: one(flashcards, {
      fields: [coverageMappings.flashcardId],
      references: [flashcards.id],
    }),
  }),
);

export const objectiveCoverageRelations = relations(
  objectiveCoverage,
  ({ one }) => ({
    objective: one(studyGuideObjectives, {
      fields: [objectiveCoverage.objectiveId],
      references: [studyGuideObjectives.id],
    }),
    supportingSlide: one(sourceSlides, {
      fields: [objectiveCoverage.supportingSlideId],
      references: [sourceSlides.id],
    }),
  }),
);

export const contentConflictsRelations = relations(
  contentConflicts,
  ({ one }) => ({
    exam: one(exams, {
      fields: [contentConflicts.examId],
      references: [exams.id],
    }),
    slideA: one(sourceSlides, {
      fields: [contentConflicts.slideAId],
      references: [sourceSlides.id],
    }),
    slideB: one(sourceSlides, {
      fields: [contentConflicts.slideBId],
      references: [sourceSlides.id],
    }),
  }),
);

export const studySessionsRelations = relations(
  studySessions,
  ({ one, many }) => ({
    exam: one(exams, { fields: [studySessions.examId], references: [exams.id] }),
    attempts: many(answerAttempts),
  }),
);

export const assistEventsRelations = relations(assistEvents, ({ one }) => ({
  flashcard: one(flashcards, {
    fields: [assistEvents.flashcardId],
    references: [flashcards.id],
  }),
}));

export const errorDiagnosesRelations = relations(errorDiagnoses, ({ one }) => ({
  flashcard: one(flashcards, {
    fields: [errorDiagnoses.flashcardId],
    references: [flashcards.id],
  }),
}));

export const answerAttemptsRelations = relations(answerAttempts, ({ one }) => ({
  flashcard: one(flashcards, {
    fields: [answerAttempts.flashcardId],
    references: [flashcards.id],
  }),
  session: one(studySessions, {
    fields: [answerAttempts.sessionId],
    references: [studySessions.id],
  }),
}));

export const studyProgressRelations = relations(studyProgress, ({ one }) => ({
  flashcard: one(flashcards, {
    fields: [studyProgress.flashcardId],
    references: [flashcards.id],
  }),
}));

/* ------------------------------------------------------------------- Types */

export type Course = typeof courses.$inferSelect;
export type Exam = typeof exams.$inferSelect;
export type SourceFile = typeof sourceFiles.$inferSelect;
export type SourceSlide = typeof sourceSlides.$inferSelect;
export type StudyGuideObjective = typeof studyGuideObjectives.$inferSelect;
export type Flashcard = typeof flashcards.$inferSelect;
export type CardRubric = typeof cardRubrics.$inferSelect;
export type CardRevision = typeof cardRevisions.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
export type GenerationJob = typeof generationJobs.$inferSelect;
export type CoverageMapping = typeof coverageMappings.$inferSelect;
export type ObjectiveCoverage = typeof objectiveCoverage.$inferSelect;
export type ContentConflict = typeof contentConflicts.$inferSelect;
export type StudyProgress = typeof studyProgress.$inferSelect;
export type StudySession = typeof studySessions.$inferSelect;
export type AnswerAttempt = typeof answerAttempts.$inferSelect;
export type AssistEvent = typeof assistEvents.$inferSelect;
export type ErrorDiagnosis = typeof errorDiagnoses.$inferSelect;

export type NewCourse = typeof courses.$inferInsert;
export type NewExam = typeof exams.$inferInsert;
export type NewSourceFile = typeof sourceFiles.$inferInsert;
export type NewSourceSlide = typeof sourceSlides.$inferInsert;
export type NewStudyGuideObjective = typeof studyGuideObjectives.$inferInsert;
export type NewFlashcard = typeof flashcards.$inferInsert;
