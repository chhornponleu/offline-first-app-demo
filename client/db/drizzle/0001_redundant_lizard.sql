PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text,
	`description` text,
	`status` text,
	`created_at` real NOT NULL,
	`updated_at` real NOT NULL,
	`deleted_at` real,
	`created_by` text,
	`updated_by` text,
	`deleted_by` text
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "full_name", "description", "status", "created_at", "updated_at", "deleted_at", "created_by", "updated_by", "deleted_by") SELECT "id", "full_name", "description", "status", "created_at", "updated_at", "deleted_at", "created_by", "updated_by", "deleted_by" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;