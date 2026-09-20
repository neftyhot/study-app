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
export type StudyProgress = typeof studyProgress.$inferSelect;

export type NewCourse = typeof courses.$inferInsert;
export type NewExam = typeof exams.$inferInsert;
export type NewSourceFile = typeof sourceFiles.$inferInsert;
export type NewSourceSlide = typeof sourceSlides.$inferInsert;
export type NewStudyGuideObjective = typeof studyGuideObjectives.$inferInsert;
export type NewFlashcard = typeof flashcards.$inferInsert;
