import {
  MAX_ZONES_PER_BRANCH,
  MODES_REQUIRED,
  TABLES_REQUIRED,
  type CreateDeliveryZoneInput,
  type DeliveryZoneDto,
  type DeliveryZoneListDto,
  type UpdateDeliveryZoneInput,
  type BranchDetailDto,
  type BranchDto,
  type BranchHoursDto,
  type BranchListDto,
  type BranchModes,
  type BusinessDto,
  type CreateBranchInput,
  type CursorQuery,
  type ReplaceHoursInput,
  type UpdateBranchInput,
  type UpdateBusinessInput,
} from "@menu-max/contracts";
import type { Db } from "../../infrastructure/db";
import { canAccessBranch } from "../../shared/authz/policies";
import { assertAllowed } from "../../shared/authz/result";
import { AppError } from "../../shared/errors";
import { newId } from "../../shared/ids";
import { log } from "../../shared/log";
import type { TenantContext } from "../../types";
import { menuVersionBumpStatement, newMenuStatement } from "../catalog/catalog.service";
import { assertWithinLimit } from "../subscriptions/limits";
import {
  findBranch,
  findBranchWithHours,
  findBusiness,
  insertBranch,
  insertZone,
  listBranches as listBranchRows,
  listZones as listZoneRows,
  softDeleteZone,
  updateZone as updateZoneRow,
  replaceHours as replaceHoursRows,
  updateBranch as updateBranchRow,
  updateBusinessName,
  type BranchChanges,
  type BranchView,
  type ZoneChanges,
  type ZoneView,
} from "./businesses.repository";
import { normalizeWeek, OVERLAPPING_HOURS } from "./hours";

/** Dependencias de un servicio con tenant; las arma `deps(c)` en las rutas. */
export type BusinessDeps = { db: Db; tenant: TenantContext; requestId: string };

export const BRANCH_VERSION_CONFLICT =
  "Alguien más cambió esta sucursal mientras la editabas. Actualiza la página y vuelve a intentarlo.";

// Negocio --------------------------------------------------------------------------------------

async function loadBusiness(deps: BusinessDeps) {
  const business = await findBusiness(deps.db, deps.tenant);
  if (!business) throw new AppError("NOT_FOUND");
  return business;
}

export async function getBusiness(deps: BusinessDeps): Promise<BusinessDto> {
  const business = await loadBusiness(deps);
  return { id: business.id, name: business.name };
}

export async function updateBusiness(
  deps: BusinessDeps,
  input: UpdateBusinessInput,
): Promise<BusinessDto> {
  const business = await loadBusiness(deps);
  const updated = await updateBusinessName(deps.db, deps.tenant, business.id, input.name);
  if (!updated) throw new AppError("NOT_FOUND");
  log.info("business.updated", { requestId: deps.requestId, orgId: deps.tenant.orgId });
  return { id: updated.id, name: updated.name };
}

// Sucursales -----------------------------------------------------------------------------------

function toBranchDto(row: BranchView): BranchDto {
  return {
    id: row.id,
    businessId: row.businessId,
    name: row.name,
    timezone: row.timezone,
    contactPhone: row.contactPhone,
    modes: { table: row.modeTable, pickup: row.modePickup, delivery: row.modeDelivery },
    tableCount: row.tableCount,
    maxOrderTotalCents: row.maxOrderTotalCents,
    alertWhatsapp: row.alertWhatsapp,
    alertOptInAt: row.alertOptInAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Reglas entre campos de la sucursal ya combinada con los cambios: al menos una modalidad activa
 * y, si atiende en mesa, al menos una mesa.
 */
function assertValidSettings(modes: BranchModes, tableCount: number) {
  if (!modes.table && !modes.pickup && !modes.delivery) {
    throw new AppError("VALIDATION_FAILED", MODES_REQUIRED, { modes: [MODES_REQUIRED] });
  }
  if (modes.table && tableCount < 1) {
    throw new AppError("VALIDATION_FAILED", TABLES_REQUIRED, { tableCount: [TABLES_REQUIRED] });
  }
}

function modeColumns(modes: BranchModes) {
  return { modeTable: modes.table, modePickup: modes.pickup, modeDelivery: modes.delivery };
}

export async function listBranches(deps: BusinessDeps, query: CursorQuery): Promise<BranchListDto> {
  const rows = await listBranchRows(deps.db, deps.tenant, query);
  const items = rows.slice(0, query.limit);
  return {
    items: items.map(toBranchDto),
    nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
  };
}

export async function getBranch(deps: BusinessDeps, branchId: string): Promise<BranchDetailDto> {
  assertAllowed(canAccessBranch(deps.tenant, branchId));
  const found = await findBranchWithHours(deps.db, deps.tenant, branchId);
  if (!found) throw new AppError("NOT_FOUND");
  return { ...toBranchDto(found.branch), hours: found.hours };
}

/**
 * Sucursal nueva del negocio de la organización, con su menú vacío en el mismo batch (T16).
 * Respeta el límite del plan (`branches`); guardar `alertWhatsapp` registra `alertOptInAt` (quien
 * lo captura confirma que el número acepta avisos).
 */
export async function createBranch(
  deps: BusinessDeps,
  input: CreateBranchInput,
  now = new Date(),
): Promise<BranchDto> {
  const tableCount = input.tableCount ?? 0;
  assertValidSettings(input.modes, tableCount);
  await assertWithinLimit(deps, "branches");
  const business = await loadBusiness(deps);

  const alertWhatsapp = input.alertWhatsapp ?? null;
  const branchId = newId();
  const row = await insertBranch(
    deps.db,
    deps.tenant,
    {
      id: branchId,
      businessId: business.id,
      name: input.name,
      timezone: input.timezone,
      contactPhone: input.contactPhone ?? null,
      ...modeColumns(input.modes),
      tableCount,
      maxOrderTotalCents: input.maxOrderTotalCents ?? null,
      alertWhatsapp,
      alertOptInAt: alertWhatsapp ? now : null,
    },
    [newMenuStatement(deps.db, deps.tenant, branchId)],
  );
  if (!row) throw new AppError("INTERNAL");
  log.info("branch.created", {
    requestId: deps.requestId,
    orgId: deps.tenant.orgId,
    branchId: row.id,
  });
  return toBranchDto(row);
}

/**
 * Cambios parciales con concurrencia optimista: `version` distinta a la guardada → `CONFLICT`.
 * Cambiar `alertWhatsapp` por otro número vuelve a registrar `alertOptInAt`; `null` borra ambos.
 */
export async function updateBranch(
  deps: BusinessDeps,
  branchId: string,
  input: UpdateBranchInput,
  now = new Date(),
): Promise<BranchDto> {
  assertAllowed(canAccessBranch(deps.tenant, branchId));
  const current = await findBranch(deps.db, deps.tenant, branchId);
  if (!current) throw new AppError("NOT_FOUND");
  if (current.version !== input.version) throw new AppError("CONFLICT", BRANCH_VERSION_CONFLICT);

  const modes = input.modes ?? {
    table: current.modeTable,
    pickup: current.modePickup,
    delivery: current.modeDelivery,
  };
  assertValidSettings(modes, input.tableCount ?? current.tableCount);

  const changes: BranchChanges = {
    name: input.name,
    timezone: input.timezone,
    contactPhone: input.contactPhone,
    ...(input.modes ? modeColumns(input.modes) : {}),
    tableCount: input.tableCount,
    maxOrderTotalCents: input.maxOrderTotalCents,
  };
  if (input.alertWhatsapp === null) {
    changes.alertWhatsapp = null;
    changes.alertOptInAt = null;
  } else if (input.alertWhatsapp !== undefined && input.alertWhatsapp !== current.alertWhatsapp) {
    changes.alertWhatsapp = input.alertWhatsapp;
    changes.alertOptInAt = now;
  }

  const updated = await updateBranchRow(deps.db, deps.tenant, branchId, input.version, changes);
  if (!updated) throw new AppError("CONFLICT", BRANCH_VERSION_CONFLICT);
  log.info("branch.updated", { requestId: deps.requestId, orgId: deps.tenant.orgId, branchId });
  return toBranchDto(updated);
}

/**
 * Reemplaza la semana completa. Los rangos que cruzan la medianoche se guardan partidos; si dos
 * rangos del mismo día se enciman → `VALIDATION_FAILED`.
 */
export async function replaceHours(
  deps: BusinessDeps,
  branchId: string,
  input: ReplaceHoursInput,
): Promise<BranchHoursDto> {
  assertAllowed(canAccessBranch(deps.tenant, branchId));
  const ranges = normalizeWeek(input.ranges);
  if (!ranges) {
    throw new AppError("VALIDATION_FAILED", OVERLAPPING_HOURS, { ranges: [OVERLAPPING_HOURS] });
  }
  await replaceHoursRows(deps.db, deps.tenant, branchId, ranges);
  log.info("branch.hours_replaced", {
    requestId: deps.requestId,
    orgId: deps.tenant.orgId,
    branchId,
  });
  return { ranges };
}

// Zonas de entrega (ADR-018) ------------------------------------------------------------------

export const ZONE_VERSION_CONFLICT =
  "Alguien más cambió esta zona mientras la editabas. Actualiza la página y vuelve a intentarlo.";
export const ZONES_LIMIT_MESSAGE = `Una sucursal admite hasta ${MAX_ZONES_PER_BRANCH} zonas de entrega. Borra una que ya no uses o junta códigos postales en una zona.`;

function toZoneDto(row: ZoneView): DeliveryZoneDto {
  return {
    id: row.id,
    branchId: row.branchId,
    name: row.name,
    postalCodes: row.postalCodes,
    feeCents: row.feeCents,
    active: row.active,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Un código postal solo puede estar en una zona activa de la sucursal (ADR-018). Compara contra
 * las demás zonas activas y no borradas; `CONFLICT` con los códigos repetidos en `fieldErrors`.
 */
function assertPostalCodesFree(
  zones: readonly ZoneView[],
  postalCodes: readonly string[],
  exceptZoneId?: string,
) {
  const taken = new Map<string, string>();
  for (const zone of zones) {
    if (!zone.active || zone.id === exceptZoneId) continue;
    for (const code of zone.postalCodes) taken.set(code, zone.name);
  }
  const conflicts = postalCodes
    .filter((code) => taken.has(code))
    .map((code) => `El código ${code} ya está en la zona "${taken.get(code)}".`);
  if (conflicts.length > 0) {
    throw new AppError(
      "CONFLICT",
      "Algunos códigos postales ya están en otra zona activa. Quítalos de una de las dos zonas.",
      { postalCodes: conflicts },
    );
  }
}

function sortedCodes(codes: readonly string[]) {
  const sorted = [...codes];
  sorted.sort();
  return sorted;
}

export async function listZones(
  deps: BusinessDeps,
  branchId: string,
): Promise<DeliveryZoneListDto> {
  assertAllowed(canAccessBranch(deps.tenant, branchId));
  const rows = await listZoneRows(deps.db, deps.tenant, branchId);
  return { items: rows.map(toZoneDto) };
}

export async function createZone(
  deps: BusinessDeps,
  branchId: string,
  input: CreateDeliveryZoneInput,
): Promise<DeliveryZoneDto> {
  assertAllowed(canAccessBranch(deps.tenant, branchId));
  const zones = await listZoneRows(deps.db, deps.tenant, branchId);
  if (zones.length >= MAX_ZONES_PER_BRANCH)
    throw new AppError("BUSINESS_RULE", ZONES_LIMIT_MESSAGE);
  const active = input.active ?? true;
  if (active) assertPostalCodesFree(zones, input.postalCodes);

  const row = await insertZone(
    deps.db,
    deps.tenant,
    {
      id: newId(),
      branchId,
      name: input.name,
      postalCodes: sortedCodes(input.postalCodes),
      feeCents: input.feeCents,
      active,
    },
    [menuVersionBumpStatement(deps.db, deps.tenant, branchId)],
  );
  if (!row) throw new AppError("INTERNAL");
  log.info("zone.created", {
    requestId: deps.requestId,
    orgId: deps.tenant.orgId,
    branchId,
    zoneId: row.id,
  });
  return toZoneDto(row);
}

/**
 * Cambios parciales con concurrencia optimista. Si la zona queda activa, sus códigos (nuevos o
 * los que ya tenía) no pueden estar en otra zona activa; reactivar una zona pausada también lo
 * revisa.
 */
export async function updateZone(
  deps: BusinessDeps,
  branchId: string,
  zoneId: string,
  input: UpdateDeliveryZoneInput,
): Promise<DeliveryZoneDto> {
  assertAllowed(canAccessBranch(deps.tenant, branchId));
  const zones = await listZoneRows(deps.db, deps.tenant, branchId);
  const current = zones.find((zone) => zone.id === zoneId);
  if (!current) throw new AppError("NOT_FOUND");
  if (current.version !== input.version) throw new AppError("CONFLICT", ZONE_VERSION_CONFLICT);

  const postalCodes = input.postalCodes ?? current.postalCodes;
  if (input.active ?? current.active) assertPostalCodesFree(zones, postalCodes, zoneId);

  const changes: ZoneChanges = {
    name: input.name,
    postalCodes: input.postalCodes ? sortedCodes(input.postalCodes) : undefined,
    feeCents: input.feeCents,
    active: input.active,
  };
  const updated = await updateZoneRow(
    deps.db,
    deps.tenant,
    branchId,
    zoneId,
    input.version,
    changes,
    [menuVersionBumpStatement(deps.db, deps.tenant, branchId)],
  );
  if (!updated) throw new AppError("CONFLICT", ZONE_VERSION_CONFLICT);
  log.info("zone.updated", {
    requestId: deps.requestId,
    orgId: deps.tenant.orgId,
    branchId,
    zoneId,
  });
  return toZoneDto(updated);
}

/** Borrado lógico (ADR-018): deja de aparecer y de atender, pero la fila queda para los pedidos. */
export async function deleteZone(
  deps: BusinessDeps,
  branchId: string,
  zoneId: string,
  now = new Date(),
) {
  assertAllowed(canAccessBranch(deps.tenant, branchId));
  const deleted = await softDeleteZone(deps.db, deps.tenant, branchId, zoneId, now, [
    menuVersionBumpStatement(deps.db, deps.tenant, branchId),
  ]);
  if (!deleted) throw new AppError("NOT_FOUND");
  log.info("zone.deleted", {
    requestId: deps.requestId,
    orgId: deps.tenant.orgId,
    branchId,
    zoneId,
  });
}
