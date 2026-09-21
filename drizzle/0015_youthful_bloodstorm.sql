CREATE TABLE `diagram_occlusions` (
	`id` text PRIMARY KEY NOT NULL,
	`flashcard_id` text NOT NULL,
	`source_slide_id` text,
	`image_path` text NOT NULL,
	`mask_coordinates` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`flashcard_id`) REFERENCES `flashcards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_slide_id`) REFERENCES `source_slides`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diagram_occlusions_card_idx` ON `diagram_occlusions` (`flashcard_id`);--> statement-breakpoint
CREATE INDEX `diagram_occlusions_slide_idx` ON `diagram_occlusions` (`source_slide_id`);