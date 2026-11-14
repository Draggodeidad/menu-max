import { MENU_STATUSES } from "@menu-max/contracts";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { branches } from "./business";
import { deletedAt, id, inList, organizationId, timestamps, version } from "./columns";
import { mediaAssets } from "./media";
import { organizations } from "./tenancy";

// Catálogo (T16, ADR-016). Un menú por sucursal; los productos cuelgan de su categoría. Todo
// precio en centavos enteros. Categorías y productos se borran lógicamente; variantes, grupos y
// opciones se reemplazan completos con su producto (los pedidos guardan su propia copia).

/**
 * Menú de una sucursal. `menu_version` sube con cada cambio del catálogo y es parte de la llave
 * de caché del menú público (ADR-014). `slug` y la publicación se completan en T18.
 */
export const menus = sqliteTable(
  "menus",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id, {
      onDelete: "restrict",
    }),
    branchId: text("branch_id").notNull(),
    slug: text("slug"),
    status: text("status", { enum: MENU_STATUSES }).notNull().default("draft"),
    menuVersion: integer("menu_version").notNull().default(1),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    version: version(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("menus_branch_id_unique").on(table.branchId),
    uniqueIndex("menus_slug_unique").on(table.slug),
    // Destino de las FKs compuestas de `categories` y `products`.
    uniqueIndex("menus_org_id_unique").on(table.organizationId, table.id),
    index("menus_org_branch_idx").on(table.organizationId, table.branchId),
    foreignKey({
      name: "menus_branch_fk",
      columns: [table.organizationId, table.branchId],
      foreignColumns: [branches.organizationId, branches.id],
    }).onDelete("restrict"),
    check("menus_status_check", inList(table.status, MENU_STATUSES)),
    check("menus_menu_version_check", sql`${table.menuVersion} >= 1`),
  ],
);

export const categories = sqliteTable(
  "categories",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id, {
      onDelete: "restrict",
    }),
    menuId: text("menu_id").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    version: version(),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex("categories_org_id_unique").on(table.organizationId, table.id),
    index("categories_org_menu_idx").on(table.organizationId, table.menuId),
    foreignKey({
      name: "categories_menu_fk",
      columns: [table.organizationId, table.menuId],
      foreignColumns: [menus.organizationId, menus.id],
    }).onDelete("restrict"),
  ],
);

/** Producto. Si tiene variantes, el precio de la variante reemplaza a `price_cents`. */
export const products = sqliteTable(
  "products",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id, {
      onDelete: "restrict",
    }),
    menuId: text("menu_id").notNull(),
    categoryId: text("category_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    priceCents: integer("price_cents").notNull(),
    available: integer("available", { mode: "boolean" }).notNull().default(true),
    position: integer("position").notNull(),
    /**
     * Imagen del producto (T17). FK simple: agregarla compuesta obligaría a reconstruir la
     * tabla; el servicio comprueba que el asset sea de la misma organización.
     */
    imageAssetId: text("image_asset_id").references(() => mediaAssets.id, {
      onDelete: "restrict",
    }),
    version: version(),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (table) => [
    // Destino de las FKs compuestas de variantes, grupos y (T21) `order_items`.
    uniqueIndex("products_org_id_unique").on(table.organizationId, table.id),
    index("products_org_menu_idx").on(table.organizationId, table.menuId),
    index("products_org_category_idx").on(table.organizationId, table.categoryId),
    // `DELETE /media/:id`: ¿algún producto activo usa la imagen?
    index("products_org_image_idx").on(table.organizationId, table.imageAssetId),
    foreignKey({
      name: "products_menu_fk",
      columns: [table.organizationId, table.menuId],
      foreignColumns: [menus.organizationId, menus.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "products_category_fk",
      columns: [table.organizationId, table.categoryId],
      foreignColumns: [categories.organizationId, categories.id],
    }).onDelete("restrict"),
    check("products_price_check", sql`${table.priceCents} >= 0`),
  ],
);

export const productVariants = sqliteTable(
  "product_variants",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id, {
      onDelete: "restrict",
    }),
    productId: text("product_id").notNull(),
    name: text("name").notNull(),
    priceCents: integer("price_cents").notNull(),
    position: integer("position").notNull(),
    version: version(),
    ...timestamps(),
  },
  (table) => [
    index("product_variants_org_product_idx").on(table.organizationId, table.productId),
    foreignKey({
      name: "product_variants_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [products.organizationId, products.id],
    }).onDelete("restrict"),
    check("product_variants_price_check", sql`${table.priceCents} >= 0`),
  ],
);

/** Grupo de opciones: el comensal elige de `min_select` a `max_select` opciones. */
export const optionGroups = sqliteTable(
  "option_groups",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id, {
      onDelete: "restrict",
    }),
    productId: text("product_id").notNull(),
    name: text("name").notNull(),
    minSelect: integer("min_select").notNull(),
    maxSelect: integer("max_select").notNull(),
    position: integer("position").notNull(),
    version: version(),
    ...timestamps(),
  },
  (table) => [
    // Destino de la FK compuesta de `options`.
    uniqueIndex("option_groups_org_id_unique").on(table.organizationId, table.id),
    index("option_groups_org_product_idx").on(table.organizationId, table.productId),
    foreignKey({
      name: "option_groups_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [products.organizationId, products.id],
    }).onDelete("restrict"),
    check(
      "option_groups_select_check",
      sql`${table.minSelect} >= 0 and ${table.maxSelect} >= 1 and ${table.minSelect} <= ${table.maxSelect}`,
    ),
  ],
);

export const options = sqliteTable(
  "options",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id, {
      onDelete: "restrict",
    }),
    optionGroupId: text("option_group_id").notNull(),
    name: text("name").notNull(),
    priceDeltaCents: integer("price_delta_cents").notNull(),
    position: integer("position").notNull(),
    version: version(),
    ...timestamps(),
  },
  (table) => [
    index("options_org_group_idx").on(table.organizationId, table.optionGroupId),
    foreignKey({
      name: "options_option_group_fk",
      columns: [table.organizationId, table.optionGroupId],
      foreignColumns: [optionGroups.organizationId, optionGroups.id],
    }).onDelete("restrict"),
    check("options_price_delta_check", sql`${table.priceDeltaCents} >= 0`),
  ],
);
