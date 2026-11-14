import {
  categories,
  menus,
  optionGroups,
  options,
  products,
  productVariants,
} from "@menu-max/database";
import { and, asc, eq, getTableColumns, isNull, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "../../infrastructure/db";
import type { TenantContext } from "../../types";

// Catálogo (T16). Toda escritura va en un solo `db.batch` junto con el aumento de
// `menus.menu_version` (ADR-014): o se aplica todo o nada.

type Statement = BatchItem<"sqlite">;
type Statements = [Statement, ...Statement[]];

// Guardas de batch --------------------------------------------------------------------------
//
// D1 no tiene transacciones interactivas: no se puede leer, decidir y escribir dentro de la misma
// transacción. Una guarda es la primera sentencia del batch y lo aborta (D1 revierte el batch
// completo) si una condición dejó de cumplirse desde la lectura del servicio, por ejemplo si otra
// persona ya cambió la `version`. SQLite no tiene `RAISE` fuera de triggers, así que la guarda
// provoca un error con `json_extract` y una ruta JSON inválida que lleva el motivo.

const GUARD_PREFIX = "mm_guard:";

/**
 * Por qué abortó una guarda: `version` vieja, el recurso (o la categoría destino) ya no existe, o
 * la categoría que se iba a borrar tiene productos.
 */
export type GuardReason = "version" | "missing" | "category_in_use";

const GUARD_PATTERN = /mm_guard:(version|missing|category_in_use)\b/;

/**
 * Sentencia que aborta el batch si `condition` es falsa. Se evalúa sobre la fila del menú, que
 * siempre existe cuando el servicio escribe (lo garantiza `ensureMenu`).
 */
function guard(db: Db, tenant: TenantContext, menuId: string, reason: GuardReason, condition: SQL) {
  return db
    .select({
      ok: sql`json_extract('{}', case when ${condition} then '$' else ${GUARD_PREFIX + reason} end)`,
    })
    .from(menus)
    .where(and(eq(menus.organizationId, tenant.orgId), eq(menus.id, menuId)));
}

/** Motivo de la guarda que abortó el batch, o `undefined` si el error es otro. */
export function guardFailure(error: unknown): GuardReason | undefined {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    const match = GUARD_PATTERN.exec(current.message);
    if (match) return match[1] as GuardReason;
    current = current.cause;
  }
  return undefined;
}

/**
 * D1 admite hasta 100 parámetros por sentencia, y Drizzle envía un parámetro por columna de cada
 * fila. Parte las inserciones de varias filas para no pasar ese tope.
 */
function insertChunks<T extends SQLiteTable>(
  db: Db,
  table: T,
  rows: readonly T["$inferInsert"][],
): Statement[] {
  const perStatement = Math.floor(100 / Object.keys(getTableColumns(table)).length);
  const statements: Statement[] = [];
  for (let start = 0; start < rows.length; start += perStatement) {
    statements.push(db.insert(table).values(rows.slice(start, start + perStatement)));
  }
  return statements;
}

// Menú --------------------------------------------------------------------------------------

const menuFields = {
  id: menus.id,
  branchId: menus.branchId,
  slug: menus.slug,
  status: menus.status,
  menuVersion: menus.menuVersion,
  publishedAt: menus.publishedAt,
};

export type MenuView = { [K in keyof typeof menuFields]: (typeof menus.$inferSelect)[K] };

function menuOfBranch(tenant: TenantContext, branchId: string) {
  return and(eq(menus.organizationId, tenant.orgId), eq(menus.branchId, branchId));
}

export function findMenu(db: Db, tenant: TenantContext, branchId: string) {
  return db.select(menuFields).from(menus).where(menuOfBranch(tenant, branchId)).get();
}

/** Crea el menú vacío de la sucursal; si ya existe, no hace nada (`branch_id` es único). */
export function insertMenu(
  db: Db,
  tenant: TenantContext,
  values: { id: string; branchId: string },
) {
  return db
    .insert(menus)
    .values({ ...values, organizationId: tenant.orgId })
    .onConflictDoNothing({ target: menus.branchId });
}

/** Sube `menu_version` en 1: invalida la caché del menú público (ADR-014). */
export function bumpMenuVersion(db: Db, tenant: TenantContext, menuId: string) {
  return db
    .update(menus)
    .set({ menuVersion: sql`${menus.menuVersion} + 1` })
    .where(and(eq(menus.organizationId, tenant.orgId), eq(menus.id, menuId)));
}

/** Igual que `bumpMenuVersion`, por sucursal; sin menú todavía, no cambia nada. */
export function bumpMenuVersionOfBranch(db: Db, tenant: TenantContext, branchId: string) {
  return db
    .update(menus)
    .set({ menuVersion: sql`${menus.menuVersion} + 1` })
    .where(menuOfBranch(tenant, branchId));
}

// Lectura del panel -------------------------------------------------------------------------

const categoryFields = {
  id: categories.id,
  name: categories.name,
  position: categories.position,
  version: categories.version,
  createdAt: categories.createdAt,
  updatedAt: categories.updatedAt,
};

export type CategoryView = {
  [K in keyof typeof categoryFields]: (typeof categories.$inferSelect)[K];
};

const productFields = {
  id: products.id,
  categoryId: products.categoryId,
  name: products.name,
  description: products.description,
  priceCents: products.priceCents,
  available: products.available,
  position: products.position,
  version: products.version,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
};

export type ProductView = {
  [K in keyof typeof productFields]: (typeof products.$inferSelect)[K];
};

const variantFields = {
  id: productVariants.id,
  name: productVariants.name,
  priceCents: productVariants.priceCents,
  position: productVariants.position,
};

const groupFields = {
  id: optionGroups.id,
  productId: optionGroups.productId,
  name: optionGroups.name,
  minSelect: optionGroups.minSelect,
  maxSelect: optionGroups.maxSelect,
  position: optionGroups.position,
};

const optionFields = {
  id: options.id,
  name: options.name,
  priceDeltaCents: options.priceDeltaCents,
  position: options.position,
};

export type VariantView = {
  [K in keyof typeof variantFields]: (typeof productVariants.$inferSelect)[K];
};
export type GroupView = { [K in keyof typeof groupFields]: (typeof optionGroups.$inferSelect)[K] };
export type OptionView = { [K in keyof typeof optionFields]: (typeof options.$inferSelect)[K] };

// En `db.batch`, Drizzle (d1) recibe cada fila como objeto y la convierte a arreglo: dos columnas
// con el mismo nombre (`id`, `name`, `position`) en un join se pisan y recorren los valores. Las
// columnas de la tabla del `left join` llevan alias únicos y llegan como `null` sin fila.
function aliased<T>(column: SQL | SQLiteColumn, alias: string) {
  return sql<T | null>`${column}`.as(alias);
}

const joinedVariantFields = {
  id: aliased<string>(productVariants.id, "variant_id"),
  name: aliased<string>(productVariants.name, "variant_name"),
  priceCents: aliased<number>(productVariants.priceCents, "variant_price_cents"),
  position: aliased<number>(productVariants.position, "variant_position"),
};

const joinedOptionFields = {
  id: aliased<string>(options.id, "option_id"),
  name: aliased<string>(options.name, "option_name"),
  priceDeltaCents: aliased<number>(options.priceDeltaCents, "option_price_delta_cents"),
  position: aliased<number>(options.position, "option_position"),
};

type Joined<T> = { [K in keyof T]: T[K] | null };

/** Fila del `left join` → vista, o `undefined` si no hubo fila a la derecha. */
function present<T extends { id: string }>(row: Joined<T>): T | undefined {
  return row.id === null ? undefined : (row as T);
}

/** Grupo con su opción (o sin ella) por fila, en el orden de la consulta. */
export type GroupRowWithOption = { group: GroupView; option: OptionView | undefined };

function groupsWithOptions(db: Db, tenant: TenantContext) {
  return db
    .select({ group: groupFields, option: joinedOptionFields })
    .from(optionGroups)
    .leftJoin(
      options,
      and(eq(options.organizationId, tenant.orgId), eq(options.optionGroupId, optionGroups.id)),
    );
}

function toGroupRows(
  rows: readonly { group: GroupView; option: Joined<OptionView> }[],
): GroupRowWithOption[] {
  return rows.map(({ group, option }) => ({ group, option: present(option) }));
}

function activeCategories(tenant: TenantContext, menuId: string) {
  return and(
    eq(categories.organizationId, tenant.orgId),
    eq(categories.menuId, menuId),
    isNull(categories.deletedAt),
  );
}

function activeProducts(tenant: TenantContext) {
  return and(eq(products.organizationId, tenant.orgId), isNull(products.deletedAt));
}

/**
 * Menú del panel en un solo `db.batch` de 4 consultas, sin N+1: menú, categorías, productos con
 * sus variantes y grupos con sus opciones. Excluye lo borrado; incluye lo no disponible.
 */
export async function readMenuTree(db: Db, tenant: TenantContext, branchId: string) {
  const [menuRows, categoryRows, productRows, groupRows] = await db.batch([
    db.select(menuFields).from(menus).where(menuOfBranch(tenant, branchId)),
    db
      .select(categoryFields)
      .from(categories)
      .innerJoin(menus, and(eq(menus.id, categories.menuId), menuOfBranch(tenant, branchId)))
      .where(and(eq(categories.organizationId, tenant.orgId), isNull(categories.deletedAt)))
      .orderBy(asc(categories.position), asc(categories.id)),
    db
      .select({ product: productFields, variant: joinedVariantFields })
      .from(products)
      .innerJoin(menus, and(eq(menus.id, products.menuId), menuOfBranch(tenant, branchId)))
      .leftJoin(
        productVariants,
        and(
          eq(productVariants.organizationId, tenant.orgId),
          eq(productVariants.productId, products.id),
        ),
      )
      .where(activeProducts(tenant))
      .orderBy(asc(products.position), asc(products.id), asc(productVariants.position)),
    groupsWithOptions(db, tenant)
      .innerJoin(products, and(eq(products.id, optionGroups.productId), activeProducts(tenant)))
      .innerJoin(menus, and(eq(menus.id, products.menuId), menuOfBranch(tenant, branchId)))
      .where(eq(optionGroups.organizationId, tenant.orgId))
      .orderBy(asc(optionGroups.position), asc(optionGroups.id), asc(options.position)),
  ]);
  return {
    menu: menuRows[0],
    categoryRows,
    productRows: productRows.map(({ product, variant }) => ({
      product,
      variant: present(variant),
    })),
    groupRows: toGroupRows(groupRows),
  };
}

// Categorías --------------------------------------------------------------------------------

/** Categorías no borradas del menú, en orden. */
export function listCategories(db: Db, tenant: TenantContext, menuId: string) {
  return db
    .select(categoryFields)
    .from(categories)
    .where(activeCategories(tenant, menuId))
    .orderBy(asc(categories.position), asc(categories.id));
}

function categoryCondition(tenant: TenantContext, menuId: string, categoryId: string) {
  return and(activeCategories(tenant, menuId), eq(categories.id, categoryId));
}

export function findCategory(db: Db, tenant: TenantContext, menuId: string, categoryId: string) {
  return db
    .select(categoryFields)
    .from(categories)
    .where(categoryCondition(tenant, menuId, categoryId))
    .get();
}

/** La categoría existe en el menú y no está borrada (para guardas). */
function categoryExists(tenant: TenantContext, menuId: string, categoryId: string) {
  return sql`exists (select 1 from ${categories} where ${categoryCondition(tenant, menuId, categoryId)})`;
}

/** Productos no borrados de la categoría (aunque no estén disponibles). */
function productsInCategory(tenant: TenantContext, categoryId: string) {
  return and(activeProducts(tenant), eq(products.categoryId, categoryId));
}

export async function categoryHasProducts(db: Db, tenant: TenantContext, categoryId: string) {
  const row = await db
    .select({ id: products.id })
    .from(products)
    .where(productsInCategory(tenant, categoryId))
    .limit(1)
    .get();
  return row !== undefined;
}

/** Al final del menú: la posición más alta + 1, calculada dentro de la misma sentencia. */
function nextCategoryPosition(tenant: TenantContext, menuId: string) {
  return sql<number>`(select coalesce(max(${categories.position}), -1) + 1 from ${categories} where ${activeCategories(tenant, menuId)})`;
}

export async function insertCategory(
  db: Db,
  tenant: TenantContext,
  menuId: string,
  values: { id: string; name: string },
) {
  const [rows] = await db.batch([
    db
      .insert(categories)
      .values({
        ...values,
        organizationId: tenant.orgId,
        menuId,
        position: nextCategoryPosition(tenant, menuId),
      })
      .returning(categoryFields),
    bumpMenuVersion(db, tenant, menuId),
  ]);
  return rows[0];
}

export async function renameCategory(
  db: Db,
  tenant: TenantContext,
  menuId: string,
  categoryId: string,
  version: number,
  name: string,
) {
  const condition = and(
    categoryCondition(tenant, menuId, categoryId),
    eq(categories.version, version),
  );
  const [, rows] = await db.batch([
    guard(
      db,
      tenant,
      menuId,
      "version",
      sql`exists (select 1 from ${categories} where ${condition})`,
    ),
    db
      .update(categories)
      .set({ name, version: sql`${categories.version} + 1` })
      .where(condition)
      .returning(categoryFields),
    bumpMenuVersion(db, tenant, menuId),
  ]);
  return rows[0];
}

/** Borrado lógico; aborta si la categoría ya no existe o si alguien le agregó un producto. */
export async function softDeleteCategory(
  db: Db,
  tenant: TenantContext,
  menuId: string,
  categoryId: string,
  now: Date,
) {
  await db.batch([
    guard(db, tenant, menuId, "missing", categoryExists(tenant, menuId, categoryId)),
    guard(
      db,
      tenant,
      menuId,
      "category_in_use",
      sql`not exists (select 1 from ${products} where ${productsInCategory(tenant, categoryId)})`,
    ),
    db
      .update(categories)
      .set({ deletedAt: now, version: sql`${categories.version} + 1` })
      .where(categoryCondition(tenant, menuId, categoryId)),
    bumpMenuVersion(db, tenant, menuId),
  ]);
}

/**
 * Posición = índice en `ids`, en una sola sentencia con `json_each` (un parámetro, sin importar
 * cuántos elementos). Cada fila reordenada sube su `version`.
 */
export async function reorderCategories(
  db: Db,
  tenant: TenantContext,
  menuId: string,
  ids: readonly string[],
) {
  const list = JSON.stringify(ids);
  const [rows] = await db.batch([
    db
      .update(categories)
      .set({
        position: sql`(select key from json_each(${list}) where value = ${categories.id})`,
        version: sql`${categories.version} + 1`,
      })
      .where(
        and(
          activeCategories(tenant, menuId),
          sql`${categories.id} in (select value from json_each(${list}))`,
        ),
      )
      .returning({ id: categories.id, position: categories.position, version: categories.version }),
    bumpMenuVersion(db, tenant, menuId),
  ]);
  return rows;
}

// Productos ---------------------------------------------------------------------------------

function productCondition(tenant: TenantContext, menuId: string, productId: string) {
  return and(activeProducts(tenant), eq(products.menuId, menuId), eq(products.id, productId));
}

export function findProduct(db: Db, tenant: TenantContext, menuId: string, productId: string) {
  return db
    .select(productFields)
    .from(products)
    .where(productCondition(tenant, menuId, productId))
    .get();
}

/** Productos no borrados de una categoría, en orden (para reordenar). */
export function listCategoryProducts(db: Db, tenant: TenantContext, categoryId: string) {
  return db
    .select({ id: products.id })
    .from(products)
    .where(productsInCategory(tenant, categoryId))
    .orderBy(asc(products.position), asc(products.id));
}

/** Producto con sus variantes y grupos de opciones, en un solo `db.batch`. */
export async function readProduct(
  db: Db,
  tenant: TenantContext,
  menuId: string,
  productId: string,
) {
  const [productRows, variantRows, groupRows] = await db.batch([
    db
      .select(productFields)
      .from(products)
      .where(productCondition(tenant, menuId, productId)),
    db
      .select(variantFields)
      .from(productVariants)
      .where(
        and(
          eq(productVariants.organizationId, tenant.orgId),
          eq(productVariants.productId, productId),
        ),
      )
      .orderBy(asc(productVariants.position)),
    groupsWithOptions(db, tenant)
      .where(
        and(eq(optionGroups.organizationId, tenant.orgId), eq(optionGroups.productId, productId)),
      )
      .orderBy(asc(optionGroups.position), asc(optionGroups.id), asc(options.position)),
  ]);
  const product = productRows[0];
  return product ? { product, variantRows, groupRows: toGroupRows(groupRows) } : undefined;
}

/** Variantes, grupos y opciones nuevos de un producto, con ids y posiciones ya asignados. */
export type ProductChildren = {
  variants: Omit<typeof productVariants.$inferInsert, "organizationId">[];
  groups: Omit<typeof optionGroups.$inferInsert, "organizationId">[];
  options: Omit<typeof options.$inferInsert, "organizationId">[];
};

function insertChildren(db: Db, tenant: TenantContext, children: ProductChildren): Statement[] {
  const orgId = tenant.orgId;
  return [
    ...insertChunks(
      db,
      productVariants,
      children.variants.map((row) => ({ ...row, organizationId: orgId })),
    ),
    ...insertChunks(
      db,
      optionGroups,
      children.groups.map((row) => ({ ...row, organizationId: orgId })),
    ),
    ...insertChunks(
      db,
      options,
      children.options.map((row) => ({ ...row, organizationId: orgId })),
    ),
  ];
}

function deleteVariants(db: Db, tenant: TenantContext, productId: string) {
  return db
    .delete(productVariants)
    .where(
      and(
        eq(productVariants.organizationId, tenant.orgId),
        eq(productVariants.productId, productId),
      ),
    );
}

/** Borra los grupos del producto y sus opciones (primero las opciones, por la FK). */
function deleteOptionGroups(db: Db, tenant: TenantContext, productId: string): Statement[] {
  const groupsOfProduct = and(
    eq(optionGroups.organizationId, tenant.orgId),
    eq(optionGroups.productId, productId),
  );
  return [
    db
      .delete(options)
      .where(
        and(
          eq(options.organizationId, tenant.orgId),
          sql`${options.optionGroupId} in (select ${optionGroups.id} from ${optionGroups} where ${groupsOfProduct})`,
        ),
      ),
    db.delete(optionGroups).where(groupsOfProduct),
  ];
}

/** Al final de la categoría, calculado dentro de la misma sentencia. */
function nextProductPosition(tenant: TenantContext, categoryId: string) {
  return sql<number>`(select coalesce(max(${products.position}), -1) + 1 from ${products} where ${productsInCategory(tenant, categoryId)})`;
}

export type NewProduct = {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceCents: number;
  available: boolean;
};

/** Producto al final de su categoría con sus hijos; aborta (`missing`) si la categoría ya no existe. */
export async function insertProduct(
  db: Db,
  tenant: TenantContext,
  menuId: string,
  values: NewProduct,
  children: ProductChildren,
) {
  await db.batch([
    guard(db, tenant, menuId, "missing", categoryExists(tenant, menuId, values.categoryId)),
    db.insert(products).values({
      ...values,
      organizationId: tenant.orgId,
      menuId,
      position: nextProductPosition(tenant, values.categoryId),
    }),
    ...insertChildren(db, tenant, children),
    bumpMenuVersion(db, tenant, menuId),
  ]);
}

export type ProductChanges = Partial<
  Pick<NewProduct, "name" | "description" | "priceCents" | "available">
>;

/**
 * Cambios del producto con concurrencia optimista. `moveTo` lo pasa al final de otra categoría;
 * `variants` u `optionGroups` presentes reemplazan los anteriores. Aborta con `version` si la
 * versión ya cambió y con `missing` si la categoría destino ya no existe.
 */
export async function updateProduct(
  db: Db,
  tenant: TenantContext,
  menuId: string,
  productId: string,
  version: number,
  update: {
    changes: ProductChanges;
    moveTo?: string;
    variants?: ProductChildren["variants"];
    optionGroups?: Pick<ProductChildren, "groups" | "options">;
  },
) {
  const condition = and(productCondition(tenant, menuId, productId), eq(products.version, version));
  const statements: Statements = [
    guard(
      db,
      tenant,
      menuId,
      "version",
      sql`exists (select 1 from ${products} where ${condition})`,
    ),
  ];
  if (update.moveTo) {
    statements.push(
      guard(db, tenant, menuId, "missing", categoryExists(tenant, menuId, update.moveTo)),
    );
  }
  statements.push(
    db
      .update(products)
      .set({
        ...update.changes,
        ...(update.moveTo
          ? { categoryId: update.moveTo, position: nextProductPosition(tenant, update.moveTo) }
          : {}),
        version: sql`${products.version} + 1`,
      })
      .where(condition),
  );
  if (update.variants) {
    statements.push(
      deleteVariants(db, tenant, productId),
      ...insertChildren(db, tenant, { variants: update.variants, groups: [], options: [] }),
    );
  }
  if (update.optionGroups) {
    statements.push(
      ...deleteOptionGroups(db, tenant, productId),
      ...insertChildren(db, tenant, { variants: [], ...update.optionGroups }),
    );
  }
  statements.push(bumpMenuVersion(db, tenant, menuId));
  await db.batch(statements);
}

export async function setProductAvailability(
  db: Db,
  tenant: TenantContext,
  menuId: string,
  productId: string,
  version: number,
  available: boolean,
) {
  const condition = and(productCondition(tenant, menuId, productId), eq(products.version, version));
  await db.batch([
    guard(
      db,
      tenant,
      menuId,
      "version",
      sql`exists (select 1 from ${products} where ${condition})`,
    ),
    db
      .update(products)
      .set({ available, version: sql`${products.version} + 1` })
      .where(condition),
    bumpMenuVersion(db, tenant, menuId),
  ]);
}

/**
 * Borrado lógico: la fila queda para los pedidos (T21). Sus variantes y opciones se conservan,
 * pero ya no se leen porque las consultas excluyen productos borrados.
 */
export async function softDeleteProduct(
  db: Db,
  tenant: TenantContext,
  menuId: string,
  productId: string,
  now: Date,
) {
  const condition = productCondition(tenant, menuId, productId);
  await db.batch([
    guard(
      db,
      tenant,
      menuId,
      "missing",
      sql`exists (select 1 from ${products} where ${condition})`,
    ),
    db
      .update(products)
      .set({ deletedAt: now, version: sql`${products.version} + 1` })
      .where(condition),
    bumpMenuVersion(db, tenant, menuId),
  ]);
}

/** Igual que `reorderCategories`, para los productos de una categoría. */
export async function reorderProducts(
  db: Db,
  tenant: TenantContext,
  menuId: string,
  categoryId: string,
  ids: readonly string[],
) {
  const list = JSON.stringify(ids);
  const [rows] = await db.batch([
    db
      .update(products)
      .set({
        position: sql`(select key from json_each(${list}) where value = ${products.id})`,
        version: sql`${products.version} + 1`,
      })
      .where(
        and(
          productsInCategory(tenant, categoryId),
          eq(products.menuId, menuId),
          sql`${products.id} in (select value from json_each(${list}))`,
        ),
      )
      .returning({ id: products.id, position: products.position, version: products.version }),
    bumpMenuVersion(db, tenant, menuId),
  ]);
  return rows;
}
