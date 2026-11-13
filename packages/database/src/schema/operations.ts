import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Tablas de operación (ADR-016). No pertenecen a un tenant: guardan cuotas y cachés globales.

/**
 * Cuotas exactas con ventana fija (ADR-010). `expires_at` = fin de la ventana; el Cron diario
 * borra las filas vencidas. La llave nunca lleva datos personales en claro.
 */
export const rateCounters = sqliteTable(
  "rate_counters",
  {
    key: text("key").notNull(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull().default(0),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.key, table.windowStart] }),
    index("rate_counters_expires_at_idx").on(table.expiresAt),
  ],
);

/** Resultado del chequeo MX por dominio (ADR-008). Válido 24 h; el Cron borra los de más de 7 días. */
export const emailDomainChecks = sqliteTable(
  "email_domain_checks",
  {
    domain: text("domain").primaryKey(),
    hasMail: integer("has_mail", { mode: "boolean" }).notNull(),
    checkedAt: integer("checked_at").notNull(),
  },
  (table) => [index("email_domain_checks_checked_at_idx").on(table.checkedAt)],
);
