import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { organizationId } from "./columns";
import { organizations } from "./tenancy";

// Tablas de operación (ADR-016). Cuotas y cachés globales, sin tenant; `idempotency_keys` sí
// pertenece a la organización que creó la petición.

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

/**
 * Respuestas guardadas por `Idempotency-Key` (ADR-013). Misma llave y mismo `request_hash` →
 * misma respuesta; otro hash → `IDEMPOTENCY_CONFLICT`. Vence a las 24 h (`expires_at`, ms) y el
 * Cron diario borra las vencidas. Se inserta en el mismo `db.batch` que el efecto que registra.
 */
export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    organizationId: organizationId().references(() => organizations.id, {
      onDelete: "restrict",
    }),
    /** Operación que registró la llave (`onboarding`, `public-order`…). */
    scope: text("scope").notNull(),
    /** SHA-256 hex del cuerpo canónico; nunca lleva contraseñas ni datos en claro. */
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code").notNull(),
    responseJson: text("response_json", { mode: "json" }).$type<unknown>().notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("idempotency_keys_org_idx").on(table.organizationId),
    index("idempotency_keys_expires_at_idx").on(table.expiresAt),
  ],
);
