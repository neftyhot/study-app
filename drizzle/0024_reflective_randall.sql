CREATE TABLE `tutor_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`title` text NOT NULL,
	`messages` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tutor_chats_exam_idx` ON `tutor_chats` (`exam_id`,`updated_at`);