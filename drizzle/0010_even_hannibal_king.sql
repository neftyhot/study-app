CREATE TABLE `generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`target_exam_id` text,
	`status` text DEFAULT 'running' NOT NULL,
	`mode` text DEFAULT 'append' NOT NULL,
	`batch_index` integer DEFAULT 0 NOT NULL,
	`batch_count` integer DEFAULT 0 NOT NULL,
	`cards_created` integer DEFAULT 0 NOT NULL,
	`cards_rejected` integer DEFAULT 0 NOT NULL,
	`error` text,
	`summary` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `generation_jobs_exam_idx` ON `generation_jobs` (`exam_id`);