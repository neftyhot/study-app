CREATE TABLE `study_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`mode` text DEFAULT 'flashcards' NOT NULL,
	`scope` text DEFAULT 'all' NOT NULL,
	`topic` text,
	`shuffled` integer DEFAULT false NOT NULL,
	`card_order` text DEFAULT '[]' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`missed_count` integer DEFAULT 0 NOT NULL,
	`difficult_count` integer DEFAULT 0 NOT NULL,
	`easy_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `study_sessions_exam_idx` ON `study_sessions` (`exam_id`);