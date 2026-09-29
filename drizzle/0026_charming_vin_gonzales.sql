DROP INDEX `primer_guides_exam_depth_idx`;--> statement-breakpoint
ALTER TABLE `primer_guides` ADD `format` text DEFAULT 'explained' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `primer_guides_exam_depth_format_idx` ON `primer_guides` (`exam_id`,`depth`,`format`);