CREATE TABLE `practice_exams` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`status` text DEFAULT 'sitting' NOT NULL,
	`duration_minutes` integer,
	`topics` text DEFAULT '[]' NOT NULL,
	`question_count` integer DEFAULT 0 NOT NULL,
	`score` integer,
	`rephrased` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`submitted_at` text,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `practice_exams_exam_idx` ON `practice_exams` (`exam_id`);--> statement-breakpoint
CREATE TABLE `practice_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_exam_id` text NOT NULL,
	`flashcard_id` text,
	`position` integer NOT NULL,
	`format` text NOT NULL,
	`prompt` text NOT NULL,
	`options` text DEFAULT '[]' NOT NULL,
	`correct_option` text,
	`expected_answer` text NOT NULL,
	`essential_points` text DEFAULT '[]' NOT NULL,
	`answer` text,
	`verdict` text,
	`error_type` text,
	`missed_points` text DEFAULT '[]' NOT NULL,
	`feedback` text,
	FOREIGN KEY (`practice_exam_id`) REFERENCES `practice_exams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`flashcard_id`) REFERENCES `flashcards`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `practice_questions_exam_idx` ON `practice_questions` (`practice_exam_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `practice_questions_position_idx` ON `practice_questions` (`practice_exam_id`,`position`);