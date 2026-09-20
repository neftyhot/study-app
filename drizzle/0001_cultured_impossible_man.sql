CREATE TABLE `content_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`topic` text,
	`statement_a` text NOT NULL,
	`slide_a_id` text,
	`statement_b` text NOT NULL,
	`slide_b_id` text,
	`explanation` text NOT NULL,
	`resolution` text,
	`dismissed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slide_a_id`) REFERENCES `source_slides`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slide_b_id`) REFERENCES `source_slides`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `content_conflicts_exam_idx` ON `content_conflicts` (`exam_id`);--> statement-breakpoint
CREATE TABLE `objective_coverage` (
	`id` text PRIMARY KEY NOT NULL,
	`objective_id` text NOT NULL,
	`status` text NOT NULL,
	`rationale` text,
	`missing_points` text DEFAULT '[]' NOT NULL,
	`source_support` text,
	`supporting_slide_id` text,
	`supporting_excerpt` text,
	`reviewed_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`objective_id`) REFERENCES `study_guide_objectives`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supporting_slide_id`) REFERENCES `source_slides`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `objective_coverage_objective_idx` ON `objective_coverage` (`objective_id`);