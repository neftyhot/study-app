CREATE TABLE `primer_guides` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`depth` text NOT NULL,
	`model` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `primer_guides_exam_depth_idx` ON `primer_guides` (`exam_id`,`depth`);--> statement-breakpoint
CREATE TABLE `primer_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`guide_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`concept_name` text NOT NULL,
	`definition` text NOT NULL,
	`breakdown` text NOT NULL,
	`example` text NOT NULL,
	`counter_example` text,
	`counter_example_at` text,
	FOREIGN KEY (`guide_id`) REFERENCES `primer_guides`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `primer_sections_guide_idx` ON `primer_sections` (`guide_id`,`order_index`);--> statement-breakpoint
ALTER TABLE `flashcards` ADD `source_document_index` integer;--> statement-breakpoint
ALTER TABLE `flashcards` ADD `source_page_number` integer;--> statement-breakpoint
ALTER TABLE `flashcards` ADD `document_order_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `flashcards_chronological_idx` ON `flashcards` (`exam_id`,`source_document_index`,`source_page_number`,`document_order_index`);
--> statement-breakpoint
-- Chronological card order (Slideshow 1 → 2 → 3, then slide, then the order
-- the cards were written). Kept by triggers rather than by each insert site,
-- so no path that writes a card can forget it. A future migration that
-- rebuilds `flashcards` or `source_files` (drizzle's __new_ table dance) drops
-- these triggers and must re-create them.
CREATE TRIGGER `flashcards_order_insert` AFTER INSERT ON `flashcards`
BEGIN
  UPDATE flashcards SET
    source_page_number = (SELECT s."index" FROM source_slides s WHERE s.id = NEW.source_slide_id),
    source_document_index = (SELECT CASE WHEN f.role = 'study_guide' THEN NULL ELSE (SELECT count(*) FROM source_files f2 WHERE f2.exam_id = f.exam_id AND f2.role <> 'study_guide' AND (f2.created_at < f.created_at OR (f2.created_at = f.created_at AND f2.rowid <= f.rowid))) END FROM source_slides s JOIN source_files f ON f.id = s.source_file_id WHERE s.id = NEW.source_slide_id),
    document_order_index = coalesce((SELECT max(c.document_order_index) FROM flashcards c WHERE c.exam_id = NEW.exam_id AND c.source_slide_id IS NEW.source_slide_id AND c.id <> NEW.id), 0) + 1
  WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER `flashcards_order_relink` AFTER UPDATE OF source_slide_id, exam_id ON `flashcards`
WHEN OLD.source_slide_id IS NOT NEW.source_slide_id OR OLD.exam_id IS NOT NEW.exam_id
BEGIN
  UPDATE flashcards SET
    source_page_number = (SELECT s."index" FROM source_slides s WHERE s.id = NEW.source_slide_id),
    source_document_index = (SELECT CASE WHEN f.role = 'study_guide' THEN NULL ELSE (SELECT count(*) FROM source_files f2 WHERE f2.exam_id = f.exam_id AND f2.role <> 'study_guide' AND (f2.created_at < f.created_at OR (f2.created_at = f.created_at AND f2.rowid <= f.rowid))) END FROM source_slides s JOIN source_files f ON f.id = s.source_file_id WHERE s.id = NEW.source_slide_id),
    document_order_index = coalesce((SELECT max(c.document_order_index) FROM flashcards c WHERE c.exam_id = NEW.exam_id AND c.source_slide_id IS NEW.source_slide_id AND c.id <> NEW.id), 0) + 1
  WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER `source_files_order_delete` AFTER DELETE ON `source_files`
BEGIN
  UPDATE flashcards SET source_document_index = (SELECT CASE WHEN f.role = 'study_guide' THEN NULL ELSE (SELECT count(*) FROM source_files f2 WHERE f2.exam_id = f.exam_id AND f2.role <> 'study_guide' AND (f2.created_at < f.created_at OR (f2.created_at = f.created_at AND f2.rowid <= f.rowid))) END FROM source_slides s JOIN source_files f ON f.id = s.source_file_id WHERE s.id = flashcards.source_slide_id)
  WHERE source_slide_id IN (SELECT s.id FROM source_slides s JOIN source_files f ON f.id = s.source_file_id WHERE f.exam_id = OLD.exam_id);
END;
--> statement-breakpoint
CREATE TRIGGER `source_files_order_update` AFTER UPDATE OF role, created_at, exam_id ON `source_files`
BEGIN
  UPDATE flashcards SET source_document_index = (SELECT CASE WHEN f.role = 'study_guide' THEN NULL ELSE (SELECT count(*) FROM source_files f2 WHERE f2.exam_id = f.exam_id AND f2.role <> 'study_guide' AND (f2.created_at < f.created_at OR (f2.created_at = f.created_at AND f2.rowid <= f.rowid))) END FROM source_slides s JOIN source_files f ON f.id = s.source_file_id WHERE s.id = flashcards.source_slide_id)
  WHERE source_slide_id IN (SELECT s.id FROM source_slides s JOIN source_files f ON f.id = s.source_file_id WHERE f.exam_id = OLD.exam_id);
  UPDATE flashcards SET source_document_index = (SELECT CASE WHEN f.role = 'study_guide' THEN NULL ELSE (SELECT count(*) FROM source_files f2 WHERE f2.exam_id = f.exam_id AND f2.role <> 'study_guide' AND (f2.created_at < f.created_at OR (f2.created_at = f.created_at AND f2.rowid <= f.rowid))) END FROM source_slides s JOIN source_files f ON f.id = s.source_file_id WHERE s.id = flashcards.source_slide_id)
  WHERE source_slide_id IN (SELECT s.id FROM source_slides s JOIN source_files f ON f.id = s.source_file_id WHERE f.exam_id = NEW.exam_id);
END;
--> statement-breakpoint
UPDATE flashcards SET
  source_page_number = (SELECT s."index" FROM source_slides s WHERE s.id = flashcards.source_slide_id),
  source_document_index = (SELECT CASE WHEN f.role = 'study_guide' THEN NULL ELSE (SELECT count(*) FROM source_files f2 WHERE f2.exam_id = f.exam_id AND f2.role <> 'study_guide' AND (f2.created_at < f.created_at OR (f2.created_at = f.created_at AND f2.rowid <= f.rowid))) END FROM source_slides s JOIN source_files f ON f.id = s.source_file_id WHERE s.id = flashcards.source_slide_id);
--> statement-breakpoint
UPDATE flashcards SET document_order_index = r.n
FROM (SELECT id, row_number() OVER (PARTITION BY exam_id, source_slide_id ORDER BY created_at, rowid) AS n FROM flashcards) AS r
WHERE r.id = flashcards.id;
