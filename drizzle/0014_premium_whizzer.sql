ALTER TABLE `exams` ADD `extraction_density` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `exams` ADD `extraction_ratio` real;--> statement-breakpoint
-- Every deck that existed before this setting was built exhaustively, which is
-- what its cards look like. New decks default to 'standard'; changing what the
-- existing ones do without being asked would be a silent behaviour change.
UPDATE `exams` SET `extraction_density` = 'exhaustive';
