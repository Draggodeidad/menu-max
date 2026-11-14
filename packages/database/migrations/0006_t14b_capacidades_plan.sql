ALTER TABLE `plans` ADD `custom_theme` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `remove_branding` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Capacidades del plan Pro (T14b). `free` conserva el valor por defecto (`false`).
UPDATE `plans` SET `custom_theme` = 1, `remove_branding` = 1 WHERE `id` = 'pro';
