CREATE TABLE `primer_topics` (
	`id` text PRIMARY KEY NOT NULL,
	`guide_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`title` text NOT NULL,
	`intro` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`guide_id`) REFERENCES `primer_guides`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `primer_topics_guide_idx` ON `primer_topics` (`guide_id`,`order_index`);--> statement-breakpoint
ALTER TABLE `primer_guides` ADD `overview` text;--> statement-breakpoint
ALTER TABLE `primer_sections` ADD `topic_id` text REFERENCES primer_topics(id);