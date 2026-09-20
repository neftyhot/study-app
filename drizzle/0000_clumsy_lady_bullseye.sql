CREATE TABLE `card_rubrics` (
	`id` text PRIMARY KEY NOT NULL,
	`flashcard_id` text NOT NULL,
	`essential_points` text DEFAULT '[]' NOT NULL,
	`optional_points` text DEFAULT '[]' NOT NULL,
	`common_misconceptions` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`flashcard_id`) REFERENCES `flashcards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_rubrics_card_idx` ON `card_rubrics` (`flashcard_id`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`term` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `coverage_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`objective_id` text NOT NULL,
	`flashcard_id` text,
	`status` text NOT NULL,
	`rationale` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`objective_id`) REFERENCES `study_guide_objectives`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`flashcard_id`) REFERENCES `flashcards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `coverage_objective_idx` ON `coverage_mappings` (`objective_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `coverage_pair_idx` ON `coverage_mappings` (`objective_id`,`flashcard_id`);--> statement-breakpoint
CREATE TABLE `exams` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`title` text NOT NULL,
	`date` text,
	`scope_mode` text DEFAULT 'files' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exams_course_idx` ON `exams` (`course_id`);--> statement-breakpoint
CREATE TABLE `flashcards` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`topic` text,
	`question` text NOT NULL,
	`direct_answer` text NOT NULL,
	`full_explanation` text,
	`card_type` text DEFAULT 'atomic' NOT NULL,
	`source_slide_id` text,
	`source_excerpt` text,
	`has_ai_supplement` integer DEFAULT false NOT NULL,
	`is_user_edited` integer DEFAULT false NOT NULL,
	`professor_emphasis` integer DEFAULT false NOT NULL,
	`starred` integer DEFAULT false NOT NULL,
	`excluded` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_slide_id`) REFERENCES `source_slides`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `flashcards_exam_idx` ON `flashcards` (`exam_id`);--> statement-breakpoint
CREATE INDEX `flashcards_source_idx` ON `flashcards` (`source_slide_id`);--> statement-breakpoint
CREATE TABLE `source_files` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`filename` text NOT NULL,
	`file_type` text NOT NULL,
	`role` text DEFAULT 'slides' NOT NULL,
	`raw_path` text NOT NULL,
	`size_bytes` integer,
	`checksum` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`unit_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_files_exam_idx` ON `source_files` (`exam_id`);--> statement-breakpoint
CREATE TABLE `source_slides` (
	`id` text PRIMARY KEY NOT NULL,
	`source_file_id` text NOT NULL,
	`index` integer NOT NULL,
	`title` text,
	`raw_text` text DEFAULT '' NOT NULL,
	`speaker_notes` text,
	`tables` text DEFAULT '[]' NOT NULL,
	`image_path` text,
	`has_diagram` integer DEFAULT false NOT NULL,
	`legibility_flag` text DEFAULT 'ok' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`source_file_id`) REFERENCES `source_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_slides_file_index_idx` ON `source_slides` (`source_file_id`,`index`);--> statement-breakpoint
CREATE TABLE `study_guide_objectives` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`source_file_id` text,
	`order_index` integer DEFAULT 0 NOT NULL,
	`label` text,
	`prompt_text` text NOT NULL,
	`professor_emphasis` integer DEFAULT false NOT NULL,
	`excluded` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_file_id`) REFERENCES `source_files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `objectives_exam_idx` ON `study_guide_objectives` (`exam_id`);--> statement-breakpoint
CREATE TABLE `study_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`flashcard_id` text NOT NULL,
	`state` text DEFAULT 'unstudied' NOT NULL,
	`interval_days` integer DEFAULT 0 NOT NULL,
	`next_review_due` text,
	`last_grade` text,
	`last_reviewed_at` text,
	`recognition_count` integer DEFAULT 0 NOT NULL,
	`immediate_recall_count` integer DEFAULT 0 NOT NULL,
	`retention_count` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`mastered_points` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`flashcard_id`) REFERENCES `flashcards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_progress_card_idx` ON `study_progress` (`flashcard_id`);--> statement-breakpoint
CREATE INDEX `study_progress_due_idx` ON `study_progress` (`next_review_due`);