CREATE TABLE `notification_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`published_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "notification_outbox_event_check" CHECK("notification_outbox"."event" in ('order.created', 'order.status_changed')),
	CONSTRAINT "notification_outbox_status_check" CHECK("notification_outbox"."status" in ('pending', 'published')),
	CONSTRAINT "notification_outbox_payload_check" CHECK(json_valid("notification_outbox"."payload_json"))
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`product_name` text NOT NULL,
	`variant_name` text,
	`options_snapshot` text DEFAULT '[]' NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`quantity` integer NOT NULL,
	`line_total_cents` integer NOT NULL,
	`notes` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`order_id`) REFERENCES `orders`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`product_id`) REFERENCES `products`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "order_items_options_snapshot_check" CHECK(json_valid("order_items"."options_snapshot") and json_type("order_items"."options_snapshot") = 'array'),
	CONSTRAINT "order_items_quantity_check" CHECK("order_items"."quantity" between 1 and 99),
	CONSTRAINT "order_items_amounts_check" CHECK("order_items"."unit_price_cents" >= 0 and "order_items"."line_total_cents" = "order_items"."unit_price_cents" * "order_items"."quantity")
);
--> statement-breakpoint
CREATE INDEX `order_items_org_order_idx` ON `order_items` (`organization_id`,`order_id`);--> statement-breakpoint
CREATE TABLE `order_status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`order_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`actor_member_id` text,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`order_id`) REFERENCES `orders`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`actor_member_id`) REFERENCES `organization_members`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "order_status_history_from_check" CHECK("order_status_history"."from_status" is null or "order_status_history"."from_status" in ('pending', 'accepted', 'rejected', 'preparing', 'ready', 'out_for_delivery', 'completed', 'delivered', 'cancelled')),
	CONSTRAINT "order_status_history_to_check" CHECK("order_status_history"."to_status" in ('pending', 'accepted', 'rejected', 'preparing', 'ready', 'out_for_delivery', 'completed', 'delivered', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `order_status_history_org_order_idx` ON `order_status_history` (`organization_id`,`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`menu_id` text NOT NULL,
	`number` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`mode` text NOT NULL,
	`table_number` integer,
	`customer_name` text NOT NULL,
	`customer_phone` text NOT NULL,
	`customer_phone_hash` text NOT NULL,
	`customer_whatsapp_opt_in` integer DEFAULT false NOT NULL,
	`delivery_street` text,
	`delivery_number` text,
	`delivery_neighborhood` text,
	`delivery_city` text,
	`delivery_postal_code` text,
	`delivery_references` text,
	`delivery_zone_id` text,
	`subtotal_cents` integer NOT NULL,
	`delivery_fee_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer NOT NULL,
	`currency` text DEFAULT 'MXN' NOT NULL,
	`payment_method` text DEFAULT 'cash' NOT NULL,
	`notes` text,
	`is_test` integer DEFAULT false NOT NULL,
	`tracking_token_hash` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`branch_id`) REFERENCES `branches`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`menu_id`) REFERENCES `menus`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`delivery_zone_id`) REFERENCES `delivery_zones`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "orders_status_check" CHECK("orders"."status" in ('pending', 'accepted', 'rejected', 'preparing', 'ready', 'out_for_delivery', 'completed', 'delivered', 'cancelled')),
	CONSTRAINT "orders_mode_check" CHECK("orders"."mode" in ('table', 'pickup', 'delivery')),
	CONSTRAINT "orders_payment_method_check" CHECK("orders"."payment_method" in ('cash')),
	CONSTRAINT "orders_currency_check" CHECK("orders"."currency" in ('MXN')),
	CONSTRAINT "orders_number_check" CHECK("orders"."number" >= 1),
	CONSTRAINT "orders_table_number_check" CHECK(("orders"."mode" = 'table' and "orders"."table_number" >= 1) or ("orders"."mode" <> 'table' and "orders"."table_number" is null)),
	CONSTRAINT "orders_delivery_check" CHECK(("orders"."mode" = 'delivery' and "orders"."delivery_street" is not null and "orders"."delivery_number" is not null and "orders"."delivery_neighborhood" is not null and "orders"."delivery_city" is not null and "orders"."delivery_postal_code" is not null and "orders"."delivery_zone_id" is not null) or ("orders"."mode" <> 'delivery' and "orders"."delivery_street" is null and "orders"."delivery_number" is null and "orders"."delivery_neighborhood" is null and "orders"."delivery_city" is null and "orders"."delivery_postal_code" is null and "orders"."delivery_references" is null and "orders"."delivery_zone_id" is null and "orders"."delivery_fee_cents" = 0)),
	CONSTRAINT "orders_amounts_check" CHECK("orders"."subtotal_cents" >= 0 and "orders"."delivery_fee_cents" >= 0 and "orders"."total_cents" = "orders"."subtotal_cents" + "orders"."delivery_fee_cents")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_org_id_unique` ON `orders` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_org_branch_number_unique` ON `orders` (`organization_id`,`branch_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_tracking_token_hash_unique` ON `orders` (`tracking_token_hash`);--> statement-breakpoint
CREATE INDEX `orders_org_branch_status_updated_idx` ON `orders` (`organization_id`,`branch_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `orders_branch_phone_created_idx` ON `orders` (`branch_id`,`customer_phone_hash`,`created_at`);