import { branches, organizationMembers, plans, products, subscriptions } from "@menu-max/database";
import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import type { Db } from "../../infrastructure/db";
import type { TenantContext } from "../../types";

/** Lo que limita un plan. */
export type LimitedResource = "branches" | "products" | "members";

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
    case "products":
      // Productos no borrados de todas las sucursales de la organización.
      return db
        .select({ count: count() })
        .from(products)
        .where(and(eq(products.organizationId, orgId), isNull(products.deletedAt)));
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
  const [rows, branchCount, productCount, memberCount] = await db.batch([
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
    countQuery(db, tenant.orgId, "products"),
    countQuery(db, tenant.orgId, "members"),
  ]);
  const subscription = rows[0];
  if (!subscription) return undefined;
  return {
    ...subscription,
    usage: {
      branches: branchCount[0]?.count ?? 0,
      products: productCount[0]?.count ?? 0,
      members: memberCount[0]?.count ?? 0,
    },
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

/** `max_products` de un plan del catálogo (sin tenant: lo usa el onboarding, T20). */
export async function findPlanMaxProducts(db: Db, planId: string) {
  const row = await db
    .select({ maxProducts: plans.maxProducts })
    .from(plans)
    .where(eq(plans.id, planId))
    .get();
  return row?.maxProducts;
}

// Fin de la prueba (T20b) ---------------------------------------------------------------------
// Consultas del Cron diario, sin tenant: recorren todas las organizaciones por lotes, con cursor
// por `subscriptions.id` (UUIDv7, ordenable). Usan el índice `(status, current_period_end)`.

export type TrialNotice = 15 | 3;

const DAY_MS = 24 * 60 * 60 * 1000;

const NOTICE_COLUMN = {
  15: subscriptions.trialNotice15SentAt,
  3: subscriptions.trialNotice3SentAt,
} as const;

const NOTICE_FIELD = {
  15: "trialNotice15SentAt",
  3: "trialNotice3SentAt",
} as const;

const afterCursor = (cursor: string | undefined) =>
  cursor === undefined ? undefined : gt(subscriptions.id, cursor);

/**
 * Pruebas que deben recibir el aviso de `notice` días y todavía no lo tienen marcado:
 * - 15 días: faltan más de 3 y hasta 15, y la prueba duró al menos 15 días (una prueba creada con
 *   menos tiempo recibe solo el de 3);
 * - 3 días: faltan más de 0 y hasta 3.
 */
export function findTrialsDueForNotice(
  db: Db,
  notice: TrialNotice,
  now: number,
  cursor: string | undefined,
  limit: number,
) {
  const end = subscriptions.currentPeriodEnd;
  const window =
    notice === 15
      ? and(
          gt(end, new Date(now + 3 * DAY_MS)),
          lte(end, new Date(now + 15 * DAY_MS)),
          sql`${subscriptions.createdAt} <= ${end} - ${15 * DAY_MS}`,
        )
      : and(gt(end, new Date(now)), lte(end, new Date(now + 3 * DAY_MS)));
  return db
    .select({
      id: subscriptions.id,
      organizationId: subscriptions.organizationId,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "trialing"),
        window,
        isNull(NOTICE_COLUMN[notice]),
        afterCursor(cursor),
      ),
    )
    .orderBy(asc(subscriptions.id))
    .limit(limit);
}

/** Marca el aviso como enviado, solo si sigue en prueba y no estaba marcado. */
export function markTrialNoticeStatement(db: Db, id: string, notice: TrialNotice, now: number) {
  return db
    .update(subscriptions)
    .set({ [NOTICE_FIELD[notice]]: new Date(now), updatedAt: new Date(now) })
    .where(
      and(
        eq(subscriptions.id, id),
        eq(subscriptions.status, "trialing"),
        isNull(NOTICE_COLUMN[notice]),
      ),
    );
}

/** Pruebas vencidas (`current_period_end <= now`) que siguen en `trialing`. */
export function findExpiredTrials(db: Db, now: number, cursor: string | undefined, limit: number) {
  return db
    .select({ id: subscriptions.id, organizationId: subscriptions.organizationId })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "trialing"),
        lte(subscriptions.currentPeriodEnd, new Date(now)),
        afterCursor(cursor),
      ),
    )
    .orderBy(asc(subscriptions.id))
    .limit(limit);
}

/**
 * Pasa las pruebas vencidas al plan `planId` en un `UPDATE` condicional (idempotente: una fila que
 * ya no está en `trialing` o que se extendió no cambia) y deja pendiente el aviso de fin de prueba.
 * Devuelve las organizaciones que sí cambiaron.
 */
export function endTrialsStatement(db: Db, ids: string[], planId: string, now: number) {
  return db
    .update(subscriptions)
    .set({
      planId,
      status: "active",
      currentPeriodEnd: null,
      trialEndedNoticePendingAt: new Date(now),
      updatedAt: new Date(now),
    })
    .where(
      and(
        inArray(subscriptions.id, ids),
        eq(subscriptions.status, "trialing"),
        lte(subscriptions.currentPeriodEnd, new Date(now)),
      ),
    )
    .returning({ organizationId: subscriptions.organizationId });
}

/** Suscripciones con el aviso de fin de prueba pendiente de encolar. */
export function findPendingTrialEndedNotices(db: Db, cursor: string | undefined, limit: number) {
  return db
    .select({
      id: subscriptions.id,
      organizationId: subscriptions.organizationId,
      planId: subscriptions.planId,
      pendingAt: subscriptions.trialEndedNoticePendingAt,
    })
    .from(subscriptions)
    .where(and(isNotNull(subscriptions.trialEndedNoticePendingAt), afterCursor(cursor)))
    .orderBy(asc(subscriptions.id))
    .limit(limit);
}

/** Resuelve el aviso de fin de prueba, solo si sigue siendo el mismo que se encoló. */
export function clearTrialEndedNoticeStatement(db: Db, id: string, pendingAt: Date, now: number) {
  return db
    .update(subscriptions)
    .set({ trialEndedNoticePendingAt: null, updatedAt: new Date(now) })
    .where(and(eq(subscriptions.id, id), eq(subscriptions.trialEndedNoticePendingAt, pendingAt)));
}

/** Nombre, límites y capacidades de un plan del catálogo. */
export function findPlan(db: Db, planId: string) {
  return db
    .select({
      name: plans.name,
      maxBranches: plans.maxBranches,
      maxProducts: plans.maxProducts,
      maxMembers: plans.maxMembers,
      customTheme: plans.customTheme,
      removeBranding: plans.removeBranding,
    })
    .from(plans)
    .where(eq(plans.id, planId))
    .get();
}

const byOrg = (rows: { organizationId: string; count: number }[]) =>
  new Map(rows.map((row) => [row.organizationId, row.count]));

/** Uso de lo que limita el plan, de varias organizaciones a la vez, en un solo `db.batch`. */
export async function countUsageByOrganization(db: Db, orgIds: string[]) {
  const [branchRows, productRows, memberRows] = await db.batch([
    db
      .select({ organizationId: branches.organizationId, count: count() })
      .from(branches)
      .where(inArray(branches.organizationId, orgIds))
      .groupBy(branches.organizationId),
    db
      .select({ organizationId: products.organizationId, count: count() })
      .from(products)
      .where(and(inArray(products.organizationId, orgIds), isNull(products.deletedAt)))
      .groupBy(products.organizationId),
    db
      .select({ organizationId: organizationMembers.organizationId, count: count() })
      .from(organizationMembers)
      .where(
        and(
          inArray(organizationMembers.organizationId, orgIds),
          eq(organizationMembers.status, "active"),
        ),
      )
      .groupBy(organizationMembers.organizationId),
  ]);
  const [branchCount, productCount, memberCount] = [
    byOrg(branchRows),
    byOrg(productRows),
    byOrg(memberRows),
  ];
  return (orgId: string) => ({
    branches: branchCount.get(orgId) ?? 0,
    products: productCount.get(orgId) ?? 0,
    members: memberCount.get(orgId) ?? 0,
  });
}
