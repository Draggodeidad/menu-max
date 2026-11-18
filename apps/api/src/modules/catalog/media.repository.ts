import { mediaAssets, products, storefrontThemes } from "@menu-max/database";
import { and, eq, isNull, or, sql } from "drizzle-orm";
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

/** Algún producto activo o el tema de un menú (logo o portada, T18) usa la imagen. */
function assetUsed(tenant: TenantContext, assetId: string) {
  const byProduct = sql`exists (select 1 from ${products} where ${and(
    eq(products.organizationId, tenant.orgId),
    eq(products.imageAssetId, assetId),
    isNull(products.deletedAt),
  )})`;
  const byTheme = sql`exists (select 1 from ${storefrontThemes} where ${and(
    eq(storefrontThemes.organizationId, tenant.orgId),
    or(eq(storefrontThemes.logoAssetId, assetId), eq(storefrontThemes.coverAssetId, assetId)),
  )})`;
  return sql`(${byProduct} or ${byTheme})`;
}

/**
 * Borrado lógico. La guarda aborta el batch (`asset_in_use`) si un producto o un tema empezó a usar
 * la imagen después de la lectura del servicio. El objeto de R2 lo elimina el Cron de T26.
 */
export async function softDeleteAsset(db: Db, tenant: TenantContext, assetId: string, now: Date) {
  await db.batch([
    assetGuard(db, tenant, assetId, "asset_in_use", sql`not ${assetUsed(tenant, assetId)}`),
    db.update(mediaAssets).set({ deletedAt: now }).where(activeAssetCondition(tenant, assetId)),
  ]);
}

/** ¿Algún producto activo o el tema de un menú usa la imagen? */
export async function assetInUse(db: Db, tenant: TenantContext, assetId: string) {
  const row = await db.get<{ used: number }>(sql`select ${assetUsed(tenant, assetId)} as used`);
  return row.used === 1;
}
