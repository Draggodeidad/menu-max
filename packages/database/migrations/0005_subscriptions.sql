CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`max_branches` integer NOT NULL,
	`max_products` integer NOT NULL,
	`max_members` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text NOT NULL,
	`current_period_end` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "subscriptions_status_check" CHECK("subscriptions"."status" in ('trialing', 'active', 'past_due', 'suspended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_organization_id_unique` ON `subscriptions` (`organization_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_plan_id_idx` ON `subscriptions` (`plan_id`);--> statement-breakpoint
-- Planes del MVP (T14). Valores provisionales: un humano los confirma antes de fusionar.
INSERT INTO `plans` (`id`, `name`, `max_branches`, `max_products`, `max_members`, `active`) VALUES
	('free', 'Gratis', 1, 60, 3, 1),
	('pro', 'Pro', 5, 1000, 20, 1);
