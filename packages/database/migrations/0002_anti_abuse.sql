CREATE TABLE `email_domain_checks` (
	`domain` text PRIMARY KEY NOT NULL,
	`has_mail` integer NOT NULL,
	`checked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_domain_checks_checked_at_idx` ON `email_domain_checks` (`checked_at`);--> statement-breakpoint
CREATE TABLE `rate_counters` (
	`key` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`key`, `window_start`)
);
--> statement-breakpoint
CREATE INDEX `rate_counters_expires_at_idx` ON `rate_counters` (`expires_at`);