CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`branch_ids` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by_member_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`invited_by_member_id`) REFERENCES `organization_members`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "invitations_role_check" CHECK("invitations"."role" in ('owner', 'admin', 'staff'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitations_org_id_idx` ON `invitations` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `invitations_org_email_idx` ON `invitations` (`organization_id`,`email`);