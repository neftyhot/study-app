CREATE TABLE `card_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`flashcard_id` text NOT NULL,
	`question` text NOT NULL,
	`direct_answer` text NOT NULL,
	`full_explanation` text,
	`was_user_edited` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`flashcard_id`) REFERENCES `flashcards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `card_revisions_card_idx` ON `card_revisions` (`flashcard_id`);