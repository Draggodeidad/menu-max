import { mediaAssets, products } from "@menu-max/database";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../../infrastructure/db";
import type { TenantContext } from "../../types";
import { assetGuard } from "./catalog.repository";

// Imágenes del panel (T17). Toda consulta filtra por `organization_id`: la imagen de otra
// organización no existe para quien pregunta.

export type NewMediaAsset = Omit<
  typeof mediaAssets.$inferInsert,
  "organizationId" | "createdAt" | "deletedAt"
>;

export async function insertMediaAsset(db: Db, tenant: TenantContext, asset: NewMediaAsset) {
  await db.insert(mediaAssets).values({ ...asset, organizationId: tenant.orgId });
}

function activeAssetCondition(tenant: TenantContext, assetId: string) {
  return and(
    eq(mediaAssets.organizationId, tenant.orgId),
    eq(mediaAssets.id, assetId),
    isNull(mediaAssets.deletedAt),
  );
}

/** Imagen no borrada de la organización. */
export function findActiveAsset(db: Db, tenant: TenantContext, assetId: string) {
  return db
    .select({
      id: mediaAssets.id,
      key: mediaAssets.key,
      width: mediaAssets.width,
      height: mediaAssets.height,
    })
    .from(mediaAssets)
    .where(activeAssetCondition(tenant, assetId))
    .get();
}

/** Ningún producto activo usa la imagen. */
function unusedAsset(tenant: TenantContext, assetId: string) {
  return sql`not exists (select 1 from ${products} where ${and(
    eq(products.organizationId, tenant.orgId),
    eq(products.imageAssetId, assetId),
    isNull(products.deletedAt),
  )})`;
}

/**
 * Borrado lógico. La guarda aborta el batch (`asset_in_use`) si un producto activo empezó a usar
 * la imagen después de la lectura del servicio. El objeto de R2 lo elimina el Cron de T26.
 */
export async function softDeleteAsset(db: Db, tenant: TenantContext, assetId: string, now: Date) {
  await db.batch([
    assetGuard(db, tenant, assetId, "asset_in_use", unusedAsset(tenant, assetId)),
    db.update(mediaAssets).set({ deletedAt: now }).where(activeAssetCondition(tenant, assetId)),
  ]);
}

/** ¿Algún producto activo usa la imagen? */
export async function assetInUse(db: Db, tenant: TenantContext, assetId: string) {
  const row = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.organizationId, tenant.orgId),
        eq(products.imageAssetId, assetId),
        isNull(products.deletedAt),
      ),
    )
    .limit(1)
    .get();
  return row !== undefined;
}
