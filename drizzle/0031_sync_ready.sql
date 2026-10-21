ALTER TABLE `courses` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `courses` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `diagram_occlusions` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `exams` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `exams` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `flashcards` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `source_files` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `source_files` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `study_guide_objectives` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `study_guide_objectives` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `study_progress` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `study_progress` ADD `deleted_at` text;--> statement-breakpoint
UPDATE `courses` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `exams` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `source_files` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `study_guide_objectives` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `study_progress` SET `updated_at` = `last_reviewed_at` WHERE `updated_at` IS NULL;
