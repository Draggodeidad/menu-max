import { SUBSCRIPTION_STATUSES } from "@menu-max/contracts";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, inList, organizationId, timestamps } from "./columns";
import { organizations } from "./tenancy";

// Planes (T14, ADR-007, ADR-016). Los límites se leen de `plans`; ningún valor vive en código.

/**
 * Catálogo de planes. La migración siembra `free` y `pro`. `active = false` lo retira para
 * suscripciones nuevas sin afectar a las que ya lo tienen. `custom_theme` y `remove_branding`
 * son capacidades (T14b): sí o no por plan, leídas de aquí y nunca de constantes.
 */
export const plans = sqliteTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  maxBranches: integer("max_branches").notNull(),
  maxProducts: integer("max_products").notNull(),
  maxMembers: integer("max_members").notNull(),
  customTheme: integer("custom_theme", { mode: "boolean" }).notNull().default(false),
  removeBranding: integer("remove_branding", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

/**
 * Suscripción de una organización (una por organización). Sin cobro automático en el MVP: un
 * humano cambia `plan_id` o `status` (ver `apps/api/docs/runbooks/cambiar-plan.md`).
 */
export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id, {
      onDelete: "restrict",
    }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    status: text("status", { enum: SUBSCRIPTION_STATUSES }).notNull(),
    currentPeriodEnd: integer("current_period_end", { mode: "timestamp_ms" }),
    // Fin de la prueba (T20b). Un aviso se marca solo después de encolarlo: `null` = pendiente.
    trialNotice15SentAt: integer("trial_notice_15_sent_at", { mode: "timestamp_ms" }),
    trialNotice3SentAt: integer("trial_notice_3_sent_at", { mode: "timestamp_ms" }),
    /** Se fija en el mismo `UPDATE` que pasa la prueba a `free`; vuelve a `null` al encolar el aviso. */
    trialEndedNoticePendingAt: integer("trial_ended_notice_pending_at", { mode: "timestamp_ms" }),
    ...timestamps(),
  },
  (table) => [
    // `requireMembership` la une por organización en la misma consulta de la membresía.
    uniqueIndex("subscriptions_organization_id_unique").on(table.organizationId),
    index("subscriptions_plan_id_idx").on(table.planId),
    // Barrido del Cron diario (T20b): pruebas por vencer o vencidas.
    index("subscriptions_status_period_end_idx").on(table.status, table.currentPeriodEnd),
    check("subscriptions_status_check", inList(table.status, SUBSCRIPTION_STATUSES)),
  ],
);
