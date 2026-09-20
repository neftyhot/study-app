CREATE TABLE `assist_events` (
	`id` text PRIMARY KEY NOT NULL,
	`flashcard_id` text NOT NULL,
	`session_id` text,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`uses_outside_knowledge` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`flashcard_id`) REFERENCES `flashcards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `study_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `assist_events_card_idx` ON `assist_events` (`flashcard_id`);--> statement-breakpoint
CREATE INDEX `assist_events_session_idx` ON `assist_events` (`session_id`);--> statement-breakpoint
CREATE TABLE `error_diagnoses` (
	`id` text PRIMARY KEY NOT NULL,
	`flashcard_id` text NOT NULL,
	`category` text NOT NULL,
	`explanation` text NOT NULL,
	`suggestion` text NOT NULL,
	`attempts_considered` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`flashcard_id`) REFERENCES `flashcards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `error_diagnoses_card_idx` ON `error_diagnoses` (`flashcard_id`);--> statement-breakpoint
ALTER TABLE `answer_attempts` ADD `assisted` integer DEFAULT false NOT NULL;