CREATE TABLE `storefront_themes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`menu_id` text NOT NULL,
	`preset` text DEFAULT 'minimal' NOT NULL,
	`primary_color` text,
	`background_color` text,
	`text_color` text,
	`font_preset` text DEFAULT 'sans' NOT NULL,
	`product_layout` text DEFAULT 'list' NOT NULL,
	`logo_asset_id` text,
	`cover_asset_id` text,
	`show_branding` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`logo_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cover_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`menu_id`) REFERENCES `menus`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "storefront_themes_preset_check" CHECK("storefront_themes"."preset" in ('minimal', 'dark', 'vibrant')),
	CONSTRAINT "storefront_themes_font_check" CHECK("storefront_themes"."font_preset" in ('sans', 'rounded', 'serif')),
	CONSTRAINT "storefront_themes_layout_check" CHECK("storefront_themes"."product_layout" in ('list', 'grid')),
	CONSTRAINT "storefront_themes_primary_check" CHECK("storefront_themes"."primary_color" is null or "storefront_themes"."primary_color" glob '#[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]'),
	CONSTRAINT "storefront_themes_background_check" CHECK("storefront_themes"."background_color" is null or "storefront_themes"."background_color" glob '#[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]'),
	CONSTRAINT "storefront_themes_text_check" CHECK("storefront_themes"."text_color" is null or "storefront_themes"."text_color" glob '#[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storefront_themes_menu_id_unique` ON `storefront_themes` (`menu_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `storefront_themes_org_menu_unique` ON `storefront_themes` (`organization_id`,`menu_id`);