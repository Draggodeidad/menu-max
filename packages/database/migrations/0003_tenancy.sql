CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`business_id` text NOT NULL,
	`name` text NOT NULL,
	`timezone` text DEFAULT 'America/Mexico_City' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`business_id`) REFERENCES `businesses`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `branches_org_id_unique` ON `branches` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `branches_org_business_idx` ON `branches` (`organization_id`,`business_id`);--> statement-breakpoint
CREATE TABLE `businesses` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `businesses_org_id_unique` ON `businesses` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `member_branches` (
	`organization_id` text NOT NULL,
	`member_id` text NOT NULL,
	`branch_id` text NOT NULL,
	PRIMARY KEY(`member_id`, `branch_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`member_id`) REFERENCES `organization_members`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`branch_id`) REFERENCES `branches`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `member_branches_org_member_idx` ON `member_branches` (`organization_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `member_branches_org_branch_idx` ON `member_branches` (`organization_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `organization_members` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "organization_members_role_check" CHECK("organization_members"."role" in ('owner', 'admin', 'staff')),
	CONSTRAINT "organization_members_status_check" CHECK("organization_members"."status" in ('active', 'removed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_members_org_user_unique` ON `organization_members` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_members_org_id_unique` ON `organization_members` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `organization_members_user_status_idx` ON `organization_members` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
