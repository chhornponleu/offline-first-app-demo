CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text,
	`description` text,
	`status` text,
	`created_at` real,
	`updated_at` real,
	`deleted_at` real,
	`created_by` text,
	`updated_by` text,
	`deleted_by` text
);
