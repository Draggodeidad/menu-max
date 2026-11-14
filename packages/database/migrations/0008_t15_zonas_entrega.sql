CREATE TABLE `delivery_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`name` text NOT NULL,
	`postal_codes` text DEFAULT '[]' NOT NULL,
	`fee_cents` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`branch_id`) REFERENCES `branches`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "delivery_zones_postal_codes_check" CHECK(json_valid("delivery_zones"."postal_codes") and json_type("delivery_zones"."postal_codes") = 'array'),
	CONSTRAINT "delivery_zones_fee_check" CHECK("delivery_zones"."fee_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_zones_org_id_unique` ON `delivery_zones` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `delivery_zones_org_branch_idx` ON `delivery_zones` (`organization_id`,`branch_id`);