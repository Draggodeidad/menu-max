import type { CursorQuery } from "@menu-max/contracts";
import { branches, businesses, businessHours, deliveryZones } from "@menu-max/database";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../../infrastructure/db";
import { newId } from "../../shared/ids";
import type { TenantContext } from "../../types";
import type { HoursRange } from "./hours";

// Negocio --------------------------------------------------------------------------------------

/** El negocio de la organización (uno por organización en el MVP; si hubiera más, el primero). */
export function findBusiness(db: Db, tenant: TenantContext) {
  return db
    .select({ id: businesses.id, name: businesses.name })
    .from(businesses)
    .where(eq(businesses.organizationId, tenant.orgId))
    .orderBy(asc(businesses.createdAt), asc(businesses.id))
    .limit(1)
    .get();
}

export function updateBusinessName(db: Db, tenant: TenantContext, id: string, name: string) {
  return db
    .update(businesses)
    .set({ name })
    .where(and(eq(businesses.organizationId, tenant.orgId), eq(businesses.id, id)))
    .returning({ id: businesses.id, name: businesses.name })
    .get();
}

// Sucursales -----------------------------------------------------------------------------------

const branchFields = {
  id: branches.id,
  businessId: branches.businessId,
  name: branches.name,
  timezone: branches.timezone,
  contactPhone: branches.contactPhone,
  modeTable: branches.modeTable,
  modePickup: branches.modePickup,
  modeDelivery: branches.modeDelivery,
  tableCount: branches.tableCount,
  maxOrderTotalCents: branches.maxOrderTotalCents,
  alertWhatsapp: branches.alertWhatsapp,
  alertOptInAt: branches.alertOptInAt,
  version: branches.version,
  createdAt: branches.createdAt,
  updatedAt: branches.updatedAt,
};

export type BranchRow = typeof branches.$inferSelect;
export type BranchView = Pick<BranchRow, keyof typeof branchFields>;

/** `staff` solo ve sus sucursales asignadas; el filtro va en SQL (ADR-007). */
function visibleTo(tenant: TenantContext) {
  return tenant.role === "staff" ? inArray(branches.id, tenant.branchIds) : undefined;
}

/** Página de sucursales ordenada por id; trae `limit + 1` para saber si hay otra. */
export function listBranches(db: Db, tenant: TenantContext, page: CursorQuery) {
  return db
    .select(branchFields)
    .from(branches)
    .where(
      and(
        eq(branches.organizationId, tenant.orgId),
        visibleTo(tenant),
        page.cursor ? gt(branches.id, page.cursor) : undefined,
      ),
    )
    .orderBy(asc(branches.id))
    .limit(page.limit + 1);
}

function hoursOf(db: Db, tenant: TenantContext, branchId: string) {
  return db
    .select({
      weekday: businessHours.weekday,
      opensAt: businessHours.opensAt,
      closesAt: businessHours.closesAt,
    })
    .from(businessHours)
    .where(
      and(eq(businessHours.organizationId, tenant.orgId), eq(businessHours.branchId, branchId)),
    )
    .orderBy(asc(businessHours.weekday), asc(businessHours.opensAt));
}

function branchQuery(db: Db, tenant: TenantContext, branchId: string) {
  return db
    .select(branchFields)
    .from(branches)
    .where(and(eq(branches.organizationId, tenant.orgId), eq(branches.id, branchId)))
    .limit(1);
}

export function findBranch(db: Db, tenant: TenantContext, branchId: string) {
  return branchQuery(db, tenant, branchId).get();
}

/** Sucursal y su semana en un solo `db.batch`. */
export async function findBranchWithHours(db: Db, tenant: TenantContext, branchId: string) {
  const [rows, hours] = await db.batch([
    branchQuery(db, tenant, branchId),
    hoursOf(db, tenant, branchId),
  ]);
  const branch = rows[0];
  return branch ? { branch, hours } : undefined;
}

export type NewBranch = Omit<
  typeof branches.$inferInsert,
  "organizationId" | "version" | "nextOrderNumber" | "createdAt" | "updatedAt"
>;

export function insertBranch(db: Db, tenant: TenantContext, values: NewBranch) {
  return db
    .insert(branches)
    .values({ ...values, organizationId: tenant.orgId })
    .returning(branchFields)
    .get();
}

export type BranchChanges = Partial<
  Pick<
    BranchRow,
    | "name"
    | "timezone"
    | "contactPhone"
    | "modeTable"
    | "modePickup"
    | "modeDelivery"
    | "tableCount"
    | "maxOrderTotalCents"
    | "alertWhatsapp"
    | "alertOptInAt"
  >
>;

/**
 * Concurrencia optimista: solo escribe si `version` coincide y la aumenta en 1. Devuelve
 * `undefined` si la versión ya cambió.
 */
export function updateBranch(
  db: Db,
  tenant: TenantContext,
  branchId: string,
  version: number,
  changes: BranchChanges,
) {
  return db
    .update(branches)
    .set({ ...changes, version: sql`${branches.version} + 1` })
    .where(
      and(
        eq(branches.organizationId, tenant.orgId),
        eq(branches.id, branchId),
        eq(branches.version, version),
      ),
    )
    .returning(branchFields)
    .get();
}

/**
 * Borra la semana anterior e inserta la nueva en un solo `db.batch` (atómico en D1). Una sentencia
 * por rango: D1 admite hasta 100 parámetros por sentencia.
 */
export async function replaceHours(
  db: Db,
  tenant: TenantContext,
  branchId: string,
  ranges: readonly HoursRange[],
) {
  const remove = db
    .delete(businessHours)
    .where(
      and(eq(businessHours.organizationId, tenant.orgId), eq(businessHours.branchId, branchId)),
    );
  const inserts = ranges.map((range) =>
    db.insert(businessHours).values({
      id: newId(),
      organizationId: tenant.orgId,
      branchId,
      weekday: range.weekday,
      opensAt: range.opensAt,
      closesAt: range.closesAt,
    }),
  );
  await db.batch([remove, ...inserts]);
}

// Zonas de entrega (ADR-018) ------------------------------------------------------------------

const zoneFields = {
  id: deliveryZones.id,
  branchId: deliveryZones.branchId,
  name: deliveryZones.name,
  postalCodes: deliveryZones.postalCodes,
  feeCents: deliveryZones.feeCents,
  active: deliveryZones.active,
  version: deliveryZones.version,
  createdAt: deliveryZones.createdAt,
  updatedAt: deliveryZones.updatedAt,
};

export type ZoneView = {
  [K in keyof typeof zoneFields]: (typeof deliveryZones.$inferSelect)[K];
};

function zonesOfBranch(tenant: TenantContext, branchId: string) {
  return and(
    eq(deliveryZones.organizationId, tenant.orgId),
    eq(deliveryZones.branchId, branchId),
    isNull(deliveryZones.deletedAt),
  );
}

/** Zonas no borradas de la sucursal, de la más vieja a la más nueva. */
export function listZones(db: Db, tenant: TenantContext, branchId: string) {
  return db
    .select(zoneFields)
    .from(deliveryZones)
    .where(zonesOfBranch(tenant, branchId))
    .orderBy(asc(deliveryZones.id));
}

export type NewZone = Pick<
  typeof deliveryZones.$inferInsert,
  "id" | "branchId" | "name" | "postalCodes" | "feeCents" | "active"
>;

export function insertZone(db: Db, tenant: TenantContext, values: NewZone) {
  return db
    .insert(deliveryZones)
    .values({ ...values, organizationId: tenant.orgId })
    .returning(zoneFields)
    .get();
}

export type ZoneChanges = Partial<Pick<NewZone, "name" | "postalCodes" | "feeCents" | "active">>;

/** Concurrencia optimista; `undefined` si la zona cambió, se borró o no existe. */
export function updateZone(
  db: Db,
  tenant: TenantContext,
  branchId: string,
  zoneId: string,
  version: number,
  changes: ZoneChanges,
) {
  return db
    .update(deliveryZones)
    .set({ ...changes, version: sql`${deliveryZones.version} + 1` })
    .where(
      and(
        zonesOfBranch(tenant, branchId),
        eq(deliveryZones.id, zoneId),
        eq(deliveryZones.version, version),
      ),
    )
    .returning(zoneFields)
    .get();
}

/** Borrado lógico: la fila queda para los pedidos que la referencian. */
export function softDeleteZone(
  db: Db,
  tenant: TenantContext,
  branchId: string,
  zoneId: string,
  now: Date,
) {
  return db
    .update(deliveryZones)
    .set({ deletedAt: now, active: false, version: sql`${deliveryZones.version} + 1` })
    .where(and(zonesOfBranch(tenant, branchId), eq(deliveryZones.id, zoneId)))
    .returning({ id: deliveryZones.id })
    .get();
}
