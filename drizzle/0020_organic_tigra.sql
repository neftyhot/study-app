ALTER TABLE `exams` ADD `study_days` integer DEFAULT 127 NOT NULL;--> statement-breakpoint
UPDATE `exams` SET `daily_minutes` = NULL;