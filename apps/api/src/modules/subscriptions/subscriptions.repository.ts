import { branches, organizationMembers, plans, subscriptions } from "@menu-max/database";
import { and, count, eq, sql, type SQL } from "drizzle-orm";
import type { Db } from "../../infrastructure/db";
import type { TenantContext } from "../../types";

/** Lo que limita un plan y hoy tiene tabla. `products` se agrega con el catálogo (T16). */
export type LimitedResource = "branches" | "members";

function activeMembersOf(orgId: string) {
  return and(
    eq(organizationMembers.organizationId, orgId),
    eq(organizationMembers.status, "active"),
  );
}

/** Consulta de conteo de un recurso de la organización (para usar sola o dentro de `db.batch`). */
function countQuery(db: Db, orgId: string, resource: LimitedResource) {
  switch (resource) {
    case "branches":
      return db.select({ count: count() }).from(branches).where(eq(branches.organizationId, orgId));
    case "members":
      return db.select({ count: count() }).from(organizationMembers).where(activeMembersOf(orgId));
  }
}

export async function countResource(db: Db, tenant: TenantContext, resource: LimitedResource) {
  const [row] = await countQuery(db, tenant.orgId, resource);
  return row?.count ?? 0;
}

/** Suscripción con su plan y el uso actual de la organización, en un solo `db.batch`. */
export async function findSubscriptionWithUsage(db: Db, tenant: TenantContext) {
  const [rows, branchCount, memberCount] = await db.batch([
    db
      .select({
        planId: subscriptions.planId,
        planName: plans.name,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        maxBranches: plans.maxBranches,
        maxProducts: plans.maxProducts,
        maxMembers: plans.maxMembers,
        customTheme: plans.customTheme,
        removeBranding: plans.removeBranding,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.organizationId, tenant.orgId))
      .limit(1),
    countQuery(db, tenant.orgId, "branches"),
    countQuery(db, tenant.orgId, "members"),
  ]);
  const subscription = rows[0];
  if (!subscription) return undefined;
  return {
    ...subscription,
    usage: { branches: branchCount[0]?.count ?? 0, members: memberCount[0]?.count ?? 0 },
  };
}

/**
 * Límite de miembros y miembros activos de una organización, sin tenant: lo usa la aceptación
 * pública de invitaciones, donde la organización sale de la invitación.
 */
export async function findMemberLimit(db: Db, orgId: string) {
  const [rows, members] = await db.batch([
    db
      .select({ maxMembers: plans.maxMembers })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.organizationId, orgId))
      .limit(1),
    countQuery(db, orgId, "members"),
  ]);
  const plan = rows[0];
  return plan ? { limit: plan.maxMembers, used: members[0]?.count ?? 0 } : undefined;
}

/**
 * Condición SQL: la organización todavía tiene lugar para un miembro activo más según su plan.
 * Se evalúa dentro de la sentencia que agrega al miembro, para cerrar la carrera de dos
 * aceptaciones simultáneas. Sin suscripción es `null` y la sentencia no aplica.
 */
export function memberSlotAvailable(db: Db, orgId: string): SQL {
  const used = db
    .select({ count: count() })
    .from(organizationMembers)
    .where(activeMembersOf(orgId));
  const limit = db
    .select({ maxMembers: plans.maxMembers })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.organizationId, orgId));
  return sql`(${used}) < (${limit})`;
}
