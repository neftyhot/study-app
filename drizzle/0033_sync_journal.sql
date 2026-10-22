-- Folder sync (desktop ↔ iPhone through a folder such as iCloud Drive).
--
-- `sync_tombstones` remembers which synced rows were deleted, so a delete on
-- one device reaches the others instead of the row coming back from their
-- copy. Recorded by triggers, so cascades (deleting an exam deletes its cards)
-- and every code path that deletes are covered without each one remembering.
--
-- The touch triggers stamp `updated_at` whenever a synced row changes without
-- the writer setting it, so "newest edit wins" sees every edit. They only
-- stamp when the writer left `updated_at` alone, so sync can still write the
-- other device's time as-is. Flashcards are scoped to the columns a student
-- can change, so the card-order triggers from 0021 don't count as edits.
-- SQLite leaves recursive_triggers off, so these don't re-fire themselves.
--
-- A future migration that rebuilds one of these tables drops its triggers and
-- must re-create them.
CREATE TABLE `sync_tombstones` (
	`table_name` text NOT NULL,
	`row_key` text NOT NULL,
	`deleted_at` text NOT NULL,
	PRIMARY KEY(`table_name`, `row_key`)
);
--> statement-breakpoint
CREATE TRIGGER `courses_sync_delete` AFTER DELETE ON `courses`
BEGIN
  INSERT OR REPLACE INTO sync_tombstones (table_name, row_key, deleted_at) VALUES ('courses', OLD.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `exams_sync_delete` AFTER DELETE ON `exams`
BEGIN
  INSERT OR REPLACE INTO sync_tombstones (table_name, row_key, deleted_at) VALUES ('exams', OLD.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `study_guide_objectives_sync_delete` AFTER DELETE ON `study_guide_objectives`
BEGIN
  INSERT OR REPLACE INTO sync_tombstones (table_name, row_key, deleted_at) VALUES ('study_guide_objectives', OLD.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `flashcards_sync_delete` AFTER DELETE ON `flashcards`
BEGIN
  INSERT OR REPLACE INTO sync_tombstones (table_name, row_key, deleted_at) VALUES ('flashcards', OLD.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `study_progress_sync_delete` AFTER DELETE ON `study_progress`
BEGIN
  INSERT OR REPLACE INTO sync_tombstones (table_name, row_key, deleted_at) VALUES ('study_progress', OLD.flashcard_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `courses_sync_touch` AFTER UPDATE ON `courses`
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE courses SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER `exams_sync_touch` AFTER UPDATE ON `exams`
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE exams SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER `study_guide_objectives_sync_touch` AFTER UPDATE ON `study_guide_objectives`
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE study_guide_objectives SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER `flashcards_sync_touch` AFTER UPDATE OF exam_id, topic, question, direct_answer, full_explanation, card_type, source_excerpt, has_ai_supplement, is_user_edited, professor_emphasis, starred, excluded, givens, calculations, from_scan, deleted_at ON `flashcards`
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE flashcards SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER `study_progress_sync_touch` AFTER UPDATE ON `study_progress`
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE study_progress SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER `study_progress_sync_insert` AFTER INSERT ON `study_progress`
WHEN NEW.updated_at IS NULL
BEGIN
  UPDATE study_progress SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
