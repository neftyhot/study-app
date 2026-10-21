CREATE TABLE `lecture_deck_links` (
	`lecture_id` text NOT NULL,
	`deck_id` text NOT NULL,
	`source_file_id` text,
	`synced_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`lecture_id`, `deck_id`),
	FOREIGN KEY (`lecture_id`) REFERENCES `lecture_transcripts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deck_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_file_id`) REFERENCES `source_files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `lecture_deck_links_deck_idx` ON `lecture_deck_links` (`deck_id`);--> statement-breakpoint
CREATE TABLE `lecture_transcripts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`audio_path` text,
	`duration_seconds` real,
	`full_text` text DEFAULT '' NOT NULL,
	`segments_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lecture_transcripts_created_idx` ON `lecture_transcripts` (`created_at`);