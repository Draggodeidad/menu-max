-- Fin de la prueba (T20b): estado de los avisos en la suscripción e índice del barrido del Cron.
-- Solo agrega columnas nullable y un índice (expand); no es destructiva.
ALTER TABLE `subscriptions` ADD `trial_notice_15_sent_at` integer;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `trial_notice_3_sent_at` integer;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `trial_ended_notice_pending_at` integer;--> statement-breakpoint
CREATE INDEX `subscriptions_status_period_end_idx` ON `subscriptions` (`status`,`current_period_end`);