CREATE TABLE `answer_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`flashcard_id` text NOT NULL,
	`session_id` text,
	`stage` text,
	`answer` text NOT NULL,
	`verdict` text NOT NULL,
	`error_type` text,
	`met_points` text DEFAULT '[]' NOT NULL,
	`missed_points` text DEFAULT '[]' NOT NULL,
	`counts_toward_mastery` integer DEFAULT false NOT NULL,
	`guessed` integer DEFAULT false NOT NULL,
	`practice` integer DEFAULT false NOT NULL,
	`overridden` integer DEFAULT false NOT NULL,
	`provisional` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`flashcard_id`) REFERENCES `flashcards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `study_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `answer_attempts_card_idx` ON `answer_attempts` (`flashcard_id`);--> statement-breakpoint
CREATE INDEX `answer_attempts_session_idx` ON `answer_attempts` (`session_id`);--> statement-breakpoint
ALTER TABLE `study_sessions` ADD `previous_round_state` text;