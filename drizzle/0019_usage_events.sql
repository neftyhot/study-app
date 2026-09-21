CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`feature` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`auth_mode` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost_usd` real,
	`duration_ms` integer NOT NULL,
	`success` integer NOT NULL,
	`uploaded_at` text
);
--> statement-breakpoint
CREATE INDEX `usage_events_created_idx` ON `usage_events` (`created_at`);