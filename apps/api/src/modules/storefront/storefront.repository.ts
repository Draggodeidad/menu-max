import {
  branches,
  businesses,
  businessHours,
  categories,
  deliveryZones,
  mediaAssets,
  menus,
  optionGroups,
  options,
  organizationMembers,
  organizations,
  plans,
  products,
  productVariants,
  storefrontThemes,
  subscriptions,
  users,
} from "@menu-max/database";
import { and, asc, eq, inArray, isNull, like, or, sql, type SQL } from "drizzle-orm";
import { alias, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db } from "../../infrastructure/db";
import type { TenantContext } from "../../types";
import type { StoredTheme } from "./theme";

// Storefront (T18). Las escrituras del panel filtran por `organization_id`. La lectura pública
// se resuelve por slug y lee solo columnas publicables, con consultas propias (ADR-006): nunca
// las del panel.

// En `db.batch`, Drizzle (d1) recibe cada fila como objeto: dos columnas con el mismo nombre en
// un join se pisan. Las columnas que se repiten entre tablas, y las de un `left join`, llevan
// alias únicos.
function aliased<T>(column: SQL | SQLiteColumn, name: string) {
  return sql<T | null>`${column}`.as(name);
}

// Menú y publicación -------------------------------------------------------------------------

const publicationFields = {
  status: menus.status,
  slug: menus.slug,
  publishedAt: menus.publishedAt,
  menuVersion: menus.menuVersion,
};

export type PublicationView = {
  [K in keyof typeof publicationFields]: (typeof menus.$inferSelect)[K];
};

function menuCondition(tenant: TenantContext, menuId: string) {
  return and(eq(menus.organizationId, tenant.orgId), eq(menus.id, menuId));
}

/** Nombre del negocio dueño de la sucursal: base del slug. */
export async function findBusinessNameOfBranch(db: Db, tenant: TenantContext, branchId: string) {
  const row = await db
    .select({ name: businesses.name })
    .from(branches)
    .innerJoin(
      businesses,
      and(
        eq(businesses.organizationId, branches.organizationId),
        eq(businesses.id, branches.businessId),
      ),
    )
    .where(and(eq(branches.organizationId, tenant.orgId), eq(branches.id, branchId)))
    .get();
  return row?.name;
}

/**
 * Lo que necesita el QR (T19): slug y estado del menú de la sucursal, y sus mesas. Sin menú (una
 * sucursal anterior al catálogo), `slug` y `status` vienen en `null`.
 */
export function findQrTarget(db: Db, tenant: TenantContext, branchId: string) {
  return db
    .select({ slug: menus.slug, status: menus.status, tableCount: branches.tableCount })
    .from(branches)
    .leftJoin(
      menus,
      and(eq(menus.organizationId, branches.organizationId), eq(menus.branchId, branches.id)),
    )
    .where(and(eq(branches.organizationId, tenant.orgId), eq(branches.id, branchId)))
    .get();
}

/**
 * Slugs existentes iguales a `base` o con la forma `base-…`. El slug es único entre todos los
 * negocios, así que esta lectura (solo de slugs) no filtra por organización.
 */
export async function findTakenSlugs(db: Db, base: string) {
  const rows = await db
    .select({ slug: menus.slug })
    .from(menus)
    .where(or(eq(menus.slug, base), like(menus.slug, `${base}-%`)));
  return new Set(rows.flatMap((row) => (row.slug ? [row.slug] : [])));
}

/** Pone el slug generado solo si el menú todavía no tiene uno. */
export function assignSlug(db: Db, tenant: TenantContext, menuId: string, slug: string) {
  return db
    .update(menus)
    .set({ slug })
    .where(and(menuCondition(tenant, menuId), isNull(menus.slug)))
    .returning(publicationFields);
}

/** Cambia el slug solo si el menú nunca se ha publicado; si no, no cambia nada. */
export async function updateSlug(db: Db, tenant: TenantContext, menuId: string, slug: string) {
  const rows = await db
    .update(menus)
    .set({ slug })
    .where(and(menuCondition(tenant, menuId), isNull(menus.publishedAt)))
    .returning(publicationFields);
  return rows[0];
}

export function findPublication(db: Db, tenant: TenantContext, menuId: string) {
  return db.select(publicationFields).from(menus).where(menuCondition(tenant, menuId)).get();
}

/** Algún producto disponible y no borrado, en una categoría no borrada del menú. */
function hasAvailableProduct(tenant: TenantContext, menuId: string) {
  return sql`exists (select 1 from ${products} inner join ${categories} on ${and(
    eq(categories.organizationId, products.organizationId),
    eq(categories.id, products.categoryId),
    isNull(categories.deletedAt),
  )} where ${and(
    eq(products.organizationId, tenant.orgId),
    eq(products.menuId, menuId),
    eq(products.available, true),
    isNull(products.deletedAt),
  )})`;
}

/**
 * Publica un menú en borrador con al menos un producto disponible, en una sola sentencia: sube
 * `menu_version` y registra `published_at`. `undefined` si ya estaba publicado o no tiene
 * productos disponibles.
 */
export async function publishMenu(db: Db, tenant: TenantContext, menuId: string, now: Date) {
  const rows = await db
    .update(menus)
    .set({
      status: "published",
      publishedAt: now,
      menuVersion: sql`${menus.menuVersion} + 1`,
    })
    .where(
      and(
        menuCondition(tenant, menuId),
        eq(menus.status, "draft"),
        hasAvailableProduct(tenant, menuId),
      ),
    )
    .returning(publicationFields);
  return rows[0];
}

/**
 * Vuelve a borrador y sube `menu_version`; `published_at` se conserva (el slug sigue fijo).
 * `undefined` si ya estaba en borrador.
 */
export async function unpublishMenu(db: Db, tenant: TenantContext, menuId: string) {
  const rows = await db
    .update(menus)
    .set({ status: "draft", menuVersion: sql`${menus.menuVersion} + 1` })
    .where(and(menuCondition(tenant, menuId), eq(menus.status, "published")))
    .returning(publicationFields);
  return rows[0];
}

/**
 * Sube `menu_version` de los menús de toda organización donde el usuario es `owner` activo. Es una
 * acción del sistema al verificar un correo (ADR-008), no de un tenant: filtra por la membresía.
 */
export async function bumpMenusOwnedBy(db: Db, userId: string) {
  await db
    .update(menus)
    .set({ menuVersion: sql`${menus.menuVersion} + 1` })
    .where(
      sql`${menus.organizationId} in (select ${organizationMembers.organizationId} from ${organizationMembers} where ${and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.role, "owner"),
        eq(organizationMembers.status, "active"),
      )})`,
    );
}

/** Sentencia que sube `menu_version` de todos los menús de varias organizaciones (sin tenant). */
export function bumpMenusOfOrganizations(db: Db, orgIds: string[]) {
  return db
    .update(menus)
    .set({ menuVersion: sql`${menus.menuVersion} + 1` })
    .where(inArray(menus.organizationId, orgIds));
}

// Tema --------------------------------------------------------------------------------------

const themeFields = {
  preset: storefrontThemes.preset,
  primaryColor: storefrontThemes.primaryColor,
  backgroundColor: storefrontThemes.backgroundColor,
  textColor: storefrontThemes.textColor,
  fontPreset: storefrontThemes.fontPreset,
  productLayout: storefrontThemes.productLayout,
  logoAssetId: storefrontThemes.logoAssetId,
  coverAssetId: storefrontThemes.coverAssetId,
  showBranding: storefrontThemes.showBranding,
  version: storefrontThemes.version,
  updatedAt: storefrontThemes.updatedAt,
};

export type ThemeView = StoredTheme & { version: number; updatedAt: Date };

function themeOfMenu(tenant: TenantContext, menuId: string) {
  return and(
    eq(storefrontThemes.organizationId, tenant.orgId),
    eq(storefrontThemes.menuId, menuId),
  );
}

export function findTheme(db: Db, tenant: TenantContext, menuId: string) {
  return db.select(themeFields).from(storefrontThemes).where(themeOfMenu(tenant, menuId)).get();
}

/** Llave en R2 de cada imagen no borrada de la organización, por id. */
export async function findAssetKeys(db: Db, tenant: TenantContext, ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: mediaAssets.id, key: mediaAssets.key })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.organizationId, tenant.orgId),
        sql`${mediaAssets.id} in (select value from json_each(${JSON.stringify(ids)}))`,
        isNull(mediaAssets.deletedAt),
      ),
    );
  return new Map(rows.map((row) => [row.id, row.key]));
}

/**
 * Guarda el tema completo con concurrencia optimista y sube `menu_version` en el mismo batch.
 * `expectedVersion` 0 = todavía no existe (se inserta con `newThemeId`). Las dos sentencias evalúan la misma condición dentro
 * del batch (sube la versión solo si el tema escribe), así que una `version` vieja no cambia
 * nada. `undefined` si la versión ya no coincide.
 */
export async function saveTheme(
  db: Db,
  tenant: TenantContext,
  menuId: string,
  expectedVersion: number,
  theme: StoredTheme,
  newThemeId: string,
) {
  const sameVersion = and(
    themeOfMenu(tenant, menuId),
    eq(storefrontThemes.version, expectedVersion),
  );
  const bumpWhen = (condition: SQL) =>
    db
      .update(menus)
      .set({ menuVersion: sql`${menus.menuVersion} + 1` })
      .where(and(menuCondition(tenant, menuId), condition));

  if (expectedVersion === 0) {
    const [, rows] = await db.batch([
      bumpWhen(
        sql`not exists (select 1 from ${storefrontThemes} where ${themeOfMenu(tenant, menuId)})`,
      ),
      db
        .insert(storefrontThemes)
        .values({ ...theme, id: newThemeId, organizationId: tenant.orgId, menuId })
        .onConflictDoNothing({ target: storefrontThemes.menuId })
        .returning(themeFields),
    ]);
    return rows[0];
  }
  const [, rows] = await db.batch([
    bumpWhen(sql`exists (select 1 from ${storefrontThemes} where ${sameVersion})`),
    db
      .update(storefrontThemes)
      .set({ ...theme, version: sql`${storefrontThemes.version} + 1` })
      .where(sameVersion)
      .returning(themeFields),
  ]);
  return rows[0];
}

// Lectura pública ---------------------------------------------------------------------------

/** Menú publicado con ese slug. Toda consulta pública parte de aquí. */
function publishedMenu(slug: string) {
  return and(eq(menus.slug, slug), eq(menus.status, "published"));
}

/** `inner join menus` del mismo tenant, publicado y con ese slug. */
function joinPublishedMenu(slug: string, organizationId: SQLiteColumn, menuId: SQL | SQLiteColumn) {
  return and(eq(menus.organizationId, organizationId), eq(menus.id, menuId), publishedMenu(slug));
}

function joinPublishedMenuOfBranch(
  slug: string,
  organizationId: SQLiteColumn,
  branchId: SQLiteColumn,
) {
  return and(
    eq(menus.organizationId, organizationId),
    eq(menus.branchId, branchId),
    publishedMenu(slug),
  );
}

const logoAsset = alias(mediaAssets, "logo_asset");
const coverAsset = alias(mediaAssets, "cover_asset");

/** Algún `owner` activo de la organización del menú tiene el correo verificado (ADR-008). */
const hasVerifiedOwner =
  sql<number>`exists (select 1 from ${organizationMembers} inner join ${users} on ${eq(
    users.id,
    organizationMembers.userId,
  )} where ${and(
    eq(organizationMembers.organizationId, menus.organizationId),
    eq(organizationMembers.role, "owner"),
    eq(organizationMembers.status, "active"),
    eq(users.emailVerified, true),
  )})`.as("has_verified_owner");

const publicHeaderFields = {
  slug: menus.slug,
  menuVersion: menus.menuVersion,
  businessName: aliased<string>(businesses.name, "business_name"),
  branchName: aliased<string>(branches.name, "branch_name"),
  timezone: branches.timezone,
  contactPhone: branches.contactPhone,
  modeTable: branches.modeTable,
  modePickup: branches.modePickup,
  modeDelivery: branches.modeDelivery,
  tableCount: branches.tableCount,
  subscriptionStatus: aliased<string>(subscriptions.status, "subscription_status"),
  customTheme: aliased<number>(plans.customTheme, "plan_custom_theme"),
  removeBranding: aliased<number>(plans.removeBranding, "plan_remove_branding"),
  hasVerifiedOwner,
  orgCreatedAt: aliased<number>(organizations.createdAt, "org_created_at"),
  themePreset: aliased<string>(storefrontThemes.preset, "theme_preset"),
  themePrimaryColor: aliased<string>(storefrontThemes.primaryColor, "theme_primary_color"),
  themeBackgroundColor: aliased<string>(storefrontThemes.backgroundColor, "theme_background_color"),
  themeTextColor: aliased<string>(storefrontThemes.textColor, "theme_text_color"),
  themeFontPreset: aliased<string>(storefrontThemes.fontPreset, "theme_font_preset"),
  themeProductLayout: aliased<string>(storefrontThemes.productLayout, "theme_product_layout"),
  themeShowBranding: aliased<number>(storefrontThemes.showBranding, "theme_show_branding"),
  logoKey: aliased<string>(logoAsset.key, "logo_key"),
  coverKey: aliased<string>(coverAsset.key, "cover_key"),
};

const publicProductFields = {
  id: products.id,
  categoryId: products.categoryId,
  name: products.name,
  description: products.description,
  priceCents: products.priceCents,
};

/** Producto disponible y no borrado, en una categoría no borrada. */
const availableProduct = and(eq(products.available, true), isNull(products.deletedAt));
const joinActiveCategory = and(
  eq(categories.organizationId, products.organizationId),
  eq(categories.id, products.categoryId),
  isNull(categories.deletedAt),
);

/**
 * Menú público en un solo `db.batch` de 6 consultas: cabecera (menú, negocio, sucursal, alta de
 * la organización, plan, dueño verificado y tema con sus imágenes), horario, zonas activas, categorías, productos
 * disponibles con variantes e imagen, y grupos con opciones.
 */
export async function readPublicMenu(db: Db, slug: string) {
  const [headerRows, hourRows, zoneRows, categoryRows, productRows, groupRows] = await db.batch([
    db
      .select(publicHeaderFields)
      .from(menus)
      .innerJoin(
        branches,
        and(eq(branches.organizationId, menus.organizationId), eq(branches.id, menus.branchId)),
      )
      .innerJoin(
        businesses,
        and(
          eq(businesses.organizationId, branches.organizationId),
          eq(businesses.id, branches.businessId),
        ),
      )
      .innerJoin(organizations, eq(organizations.id, menus.organizationId))
      .leftJoin(subscriptions, eq(subscriptions.organizationId, menus.organizationId))
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .leftJoin(
        storefrontThemes,
        and(
          eq(storefrontThemes.organizationId, menus.organizationId),
          eq(storefrontThemes.menuId, menus.id),
        ),
      )
      .leftJoin(
        logoAsset,
        and(
          eq(logoAsset.organizationId, menus.organizationId),
          eq(logoAsset.id, storefrontThemes.logoAssetId),
          isNull(logoAsset.deletedAt),
        ),
      )
      .leftJoin(
        coverAsset,
        and(
          eq(coverAsset.organizationId, menus.organizationId),
          eq(coverAsset.id, storefrontThemes.coverAssetId),
          isNull(coverAsset.deletedAt),
        ),
      )
      .where(publishedMenu(slug)),
    db
      .select({
        weekday: businessHours.weekday,
        opensAt: businessHours.opensAt,
        closesAt: businessHours.closesAt,
      })
      .from(businessHours)
      .innerJoin(
        menus,
        joinPublishedMenuOfBranch(slug, businessHours.organizationId, businessHours.branchId),
      )
      .orderBy(asc(businessHours.weekday), asc(businessHours.opensAt)),
    db
      .select({ name: deliveryZones.name, feeCents: deliveryZones.feeCents })
      .from(deliveryZones)
      .innerJoin(
        menus,
        joinPublishedMenuOfBranch(slug, deliveryZones.organizationId, deliveryZones.branchId),
      )
      .where(and(eq(deliveryZones.active, true), isNull(deliveryZones.deletedAt)))
      .orderBy(asc(deliveryZones.feeCents), asc(deliveryZones.name)),
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .innerJoin(menus, joinPublishedMenu(slug, categories.organizationId, categories.menuId))
      .where(isNull(categories.deletedAt))
      .orderBy(asc(categories.position), asc(categories.id)),
    db
      .select({
        product: publicProductFields,
        variantId: aliased<string>(productVariants.id, "variant_id"),
        variantName: aliased<string>(productVariants.name, "variant_name"),
        variantPriceCents: aliased<number>(productVariants.priceCents, "variant_price_cents"),
        imageKey: aliased<string>(mediaAssets.key, "image_key"),
        imageWidth: aliased<number>(mediaAssets.width, "image_width"),
        imageHeight: aliased<number>(mediaAssets.height, "image_height"),
      })
      .from(products)
      .innerJoin(menus, joinPublishedMenu(slug, products.organizationId, products.menuId))
      .innerJoin(categories, joinActiveCategory)
      .leftJoin(
        mediaAssets,
        and(
          eq(mediaAssets.organizationId, products.organizationId),
          eq(mediaAssets.id, products.imageAssetId),
          isNull(mediaAssets.deletedAt),
        ),
      )
      .leftJoin(
        productVariants,
        and(
          eq(productVariants.organizationId, products.organizationId),
          eq(productVariants.productId, products.id),
        ),
      )
      .where(availableProduct)
      .orderBy(asc(products.position), asc(products.id), asc(productVariants.position)),
    optionRows(db, slug),
  ]);
  return { header: headerRows[0], hourRows, zoneRows, categoryRows, productRows, groupRows };
}

// Checkout (T21) ------------------------------------------------------------------------------

/** Opciones de los grupos de los productos del menú publicado, en el orden del catálogo. */
function optionRows(db: Db, slug: string, productIds?: readonly string[]) {
  return db
    .select({
      groupId: aliased<string>(optionGroups.id, "group_id"),
      productId: optionGroups.productId,
      groupName: aliased<string>(optionGroups.name, "group_name"),
      minSelect: optionGroups.minSelect,
      maxSelect: optionGroups.maxSelect,
      optionId: aliased<string>(options.id, "option_id"),
      optionName: aliased<string>(options.name, "option_name"),
      priceDeltaCents: aliased<number>(options.priceDeltaCents, "option_price_delta_cents"),
    })
    .from(optionGroups)
    .innerJoin(
      products,
      and(
        eq(products.organizationId, optionGroups.organizationId),
        eq(products.id, optionGroups.productId),
        availableProduct,
        productIds ? inArray(products.id, [...productIds]) : undefined,
      ),
    )
    .innerJoin(categories, joinActiveCategory)
    .innerJoin(menus, joinPublishedMenu(slug, products.organizationId, products.menuId))
    .leftJoin(
      options,
      and(
        eq(options.organizationId, optionGroups.organizationId),
        eq(options.optionGroupId, optionGroups.id),
      ),
    )
    .orderBy(asc(optionGroups.position), asc(optionGroups.id), asc(options.position));
}

/**
 * Lo que necesita un pedido público, en un solo `db.batch` de 5 consultas y siempre desde D1
 * (ADR-014): cabecera (ids del menú, sucursal y organización, modalidades, mesas, tope del total,
 * suscripción, dueño verificado y alta de la organización), horario, la zona activa que atiende
 * `postalCode` (ADR-018), y los productos pedidos que siguen disponibles con sus variantes y sus
 * grupos de opciones. Un producto de otro menú, borrado, no disponible o en una categoría borrada
 * no aparece.
 */
export async function readCheckout(
  db: Db,
  slug: string,
  productIds: readonly string[],
  postalCode: string | null,
) {
  const [headerRows, hourRows, zoneRows, productRows, groupRows] = await db.batch([
    db
      .select({
        orgId: menus.organizationId,
        menuId: menus.id,
        branchId: menus.branchId,
        timezone: branches.timezone,
        modeTable: branches.modeTable,
        modePickup: branches.modePickup,
        modeDelivery: branches.modeDelivery,
        tableCount: branches.tableCount,
        maxOrderTotalCents: branches.maxOrderTotalCents,
        subscriptionStatus: aliased<string>(subscriptions.status, "subscription_status"),
        hasVerifiedOwner,
        orgCreatedAt: aliased<number>(organizations.createdAt, "org_created_at"),
      })
      .from(menus)
      .innerJoin(
        branches,
        and(eq(branches.organizationId, menus.organizationId), eq(branches.id, menus.branchId)),
      )
      .innerJoin(organizations, eq(organizations.id, menus.organizationId))
      .leftJoin(subscriptions, eq(subscriptions.organizationId, menus.organizationId))
      .where(publishedMenu(slug)),
    db
      .select({
        weekday: businessHours.weekday,
        opensAt: businessHours.opensAt,
        closesAt: businessHours.closesAt,
      })
      .from(businessHours)
      .innerJoin(
        menus,
        joinPublishedMenuOfBranch(slug, businessHours.organizationId, businessHours.branchId),
      )
      .orderBy(asc(businessHours.weekday), asc(businessHours.opensAt)),
    db
      .select({ id: deliveryZones.id, feeCents: deliveryZones.feeCents })
      .from(deliveryZones)
      .innerJoin(
        menus,
        joinPublishedMenuOfBranch(slug, deliveryZones.organizationId, deliveryZones.branchId),
      )
      .where(
        and(
          eq(deliveryZones.active, true),
          isNull(deliveryZones.deletedAt),
          // Sin código postal, `value = null` nunca coincide.
          sql`exists (select 1 from json_each(${deliveryZones.postalCodes}) where value = ${postalCode})`,
        ),
      )
      .orderBy(asc(deliveryZones.id))
      .limit(1),
    db
      .select({
        id: products.id,
        name: products.name,
        priceCents: products.priceCents,
        variantId: aliased<string>(productVariants.id, "variant_id"),
        variantName: aliased<string>(productVariants.name, "variant_name"),
        variantPriceCents: aliased<number>(productVariants.priceCents, "variant_price_cents"),
      })
      .from(products)
      .innerJoin(menus, joinPublishedMenu(slug, products.organizationId, products.menuId))
      .innerJoin(categories, joinActiveCategory)
      .leftJoin(
        productVariants,
        and(
          eq(productVariants.organizationId, products.organizationId),
          eq(productVariants.productId, products.id),
        ),
      )
      .where(and(availableProduct, inArray(products.id, [...productIds])))
      .orderBy(asc(products.id), asc(productVariants.position)),
    optionRows(db, slug, productIds),
  ]);
  return { header: headerRows[0], hourRows, zone: zoneRows[0], productRows, groupRows };
}

/** Solo `menu_version` del menú publicado (llave de caché en WEB, ADR-014). */
export function findPublicMenuVersion(db: Db, slug: string) {
  return db.select({ menuVersion: menus.menuVersion }).from(menus).where(publishedMenu(slug)).get();
}
