CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_by_member_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`created_by_member_id`) REFERENCES `organization_members`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "media_assets_content_type_check" CHECK("media_assets"."content_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "media_assets_size_check" CHECK("media_assets"."size_bytes" > 0 and "media_assets"."width" > 0 and "media_assets"."height" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_key_unique` ON `media_assets` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_org_id_unique` ON `media_assets` (`organization_id`,`id`);--> statement-breakpoint
ALTER TABLE `products` ADD `image_asset_id` text REFERENCES media_assets(id);--> statement-breakpoint
CREATE INDEX `products_org_image_idx` ON `products` (`organization_id`,`image_asset_id`);