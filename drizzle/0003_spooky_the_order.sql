ALTER TABLE `study_sessions` ADD `round_size` integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE `study_sessions` ADD `round_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `study_sessions` ADD `round_state` text;