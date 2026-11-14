CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`menu_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`menu_id`) REFERENCES `menus`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_org_id_unique` ON `categories` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `categories_org_menu_idx` ON `categories` (`organization_id`,`menu_id`);--> statement-breakpoint
CREATE TABLE `menus` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`slug` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`menu_version` integer DEFAULT 1 NOT NULL,
	`published_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`branch_id`) REFERENCES `branches`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menus_status_check" CHECK("menus"."status" in ('draft', 'published')),
	CONSTRAINT "menus_menu_version_check" CHECK("menus"."menu_version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menus_branch_id_unique` ON `menus` (`branch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `menus_slug_unique` ON `menus` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `menus_org_id_unique` ON `menus` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `menus_org_branch_idx` ON `menus` (`organization_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `option_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`min_select` integer NOT NULL,
	`max_select` integer NOT NULL,
	`position` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`product_id`) REFERENCES `products`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "option_groups_select_check" CHECK("option_groups"."min_select" >= 0 and "option_groups"."max_select" >= 1 and "option_groups"."min_select" <= "option_groups"."max_select")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `option_groups_org_id_unique` ON `option_groups` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `option_groups_org_product_idx` ON `option_groups` (`organization_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `options` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`option_group_id` text NOT NULL,
	`name` text NOT NULL,
	`price_delta_cents` integer NOT NULL,
	`position` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`option_group_id`) REFERENCES `option_groups`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "options_price_delta_check" CHECK("options"."price_delta_cents" >= 0)
);
--> statement-breakpoint
CREATE INDEX `options_org_group_idx` ON `options` (`organization_id`,`option_group_id`);--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`price_cents` integer NOT NULL,
	`position` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`product_id`) REFERENCES `products`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "product_variants_price_check" CHECK("product_variants"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE INDEX `product_variants_org_product_idx` ON `product_variants` (`organization_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`menu_id` text NOT NULL,
	`category_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`price_cents` integer NOT NULL,
	`available` integer DEFAULT true NOT NULL,
	`position` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`menu_id`) REFERENCES `menus`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`category_id`) REFERENCES `categories`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "products_price_check" CHECK("products"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_org_id_unique` ON `products` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `products_org_menu_idx` ON `products` (`organization_id`,`menu_id`);--> statement-breakpoint
CREATE INDEX `products_org_category_idx` ON `products` (`organization_id`,`category_id`);