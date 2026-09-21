CREATE TABLE `google_oauth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`access_token` text NOT NULL,
	`access_token_expires_at` integer NOT NULL,
	`refresh_token_encrypted` text NOT NULL,
	`scope` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
