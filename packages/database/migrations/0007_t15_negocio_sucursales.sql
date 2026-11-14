CREATE TABLE `business_hours` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`opens_at` text NOT NULL,
	`closes_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`branch_id`) REFERENCES `branches`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "business_hours_weekday_check" CHECK("business_hours"."weekday" between 0 and 6),
	CONSTRAINT "business_hours_range_check" CHECK("business_hours"."opens_at" < "business_hours"."closes_at")
);
--> statement-breakpoint
CREATE INDEX `business_hours_org_branch_idx` ON `business_hours` (`organization_id`,`branch_id`);--> statement-breakpoint
ALTER TABLE `branches` ADD `contact_phone` text;--> statement-breakpoint
ALTER TABLE `branches` ADD `mode_table` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `branches` ADD `mode_pickup` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `branches` ADD `mode_delivery` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `branches` ADD `table_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `branches` ADD `max_order_total_cents` integer;--> statement-breakpoint
ALTER TABLE `branches` ADD `alert_whatsapp` text;--> statement-breakpoint
ALTER TABLE `branches` ADD `alert_opt_in_at` integer;--> statement-breakpoint
ALTER TABLE `branches` ADD `next_order_number` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `branches` ADD `version` integer DEFAULT 1 NOT NULL;