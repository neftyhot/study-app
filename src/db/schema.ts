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
import {
  index,
  integer,
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
    createdAt: createdAt(),
  },
  (t) => [index("exams_course_idx").on(t.courseId)],
);

/* -------------------------------------------------------------- SourceFile */

export const sourceFileTypes = ["pdf", "pptx", "docx", "image"] as const;
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

export const cardTypes = ["atomic", "process", "integration"] as const;

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
    /** ISO date-time; null means "not yet scheduled". */
    nextReviewDue: text("next_review_due"),
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

export const sessionScopes = ["all", "topic", "starred", "missed"] as const;

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

export const studySessionsRelations = relations(studySessions, ({ one }) => ({
  exam: one(exams, { fields: [studySessions.examId], references: [exams.id] }),
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
export type CoverageMapping = typeof coverageMappings.$inferSelect;
export type ObjectiveCoverage = typeof objectiveCoverage.$inferSelect;
export type ContentConflict = typeof contentConflicts.$inferSelect;
export type StudyProgress = typeof studyProgress.$inferSelect;
export type StudySession = typeof studySessions.$inferSelect;

export type NewCourse = typeof courses.$inferInsert;
export type NewExam = typeof exams.$inferInsert;
export type NewSourceFile = typeof sourceFiles.$inferInsert;
export type NewSourceSlide = typeof sourceSlides.$inferInsert;
export type NewStudyGuideObjective = typeof studyGuideObjectives.$inferInsert;
export type NewFlashcard = typeof flashcards.$inferInsert;
