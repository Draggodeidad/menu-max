import { SUBSCRIPTION_STATUSES } from "@menu-max/contracts";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, inList, organizationId, timestamps } from "./columns";
import { organizations } from "./tenancy";

// Planes (T14, ADR-007, ADR-016). Los límites se leen de `plans`; ningún valor vive en código.

/**
 * Catálogo de planes. La migración siembra `free` y `pro`. `active = false` lo retira para
 * suscripciones nuevas sin afectar a las que ya lo tienen.
 */
export const plans = sqliteTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  maxBranches: integer("max_branches").notNull(),
  maxProducts: integer("max_products").notNull(),
  maxMembers: integer("max_members").notNull(),
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
    ...timestamps(),
  },
  (table) => [
    // `requireMembership` la une por organización en la misma consulta de la membresía.
    uniqueIndex("subscriptions_organization_id_unique").on(table.organizationId),
    index("subscriptions_plan_id_idx").on(table.planId),
    check("subscriptions_status_check", inList(table.status, SUBSCRIPTION_STATUSES)),
  ],
);
