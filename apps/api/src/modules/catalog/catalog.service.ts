import {
  MAX_CATEGORIES_PER_MENU,
  type CategoryDto,
  type CreateCategoryInput,
  type CreateProductInput,
  type MenuDto,
  type OptionGroupDto,
  type OptionGroupInput,
  type ProductAvailabilityInput,
  type ProductDto,
  type ReorderInput,
  type ReorderResultDto,
  type UpdateCategoryInput,
  type UpdateProductInput,
  type VariantDto,
  type VariantInput,
} from "@menu-max/contracts";
import type { Db } from "../../infrastructure/db";
import { canAccessBranch } from "../../shared/authz/policies";
import { assertAllowed } from "../../shared/authz/result";
import { AppError } from "../../shared/errors";
import { newId } from "../../shared/ids";
import { log } from "../../shared/log";
import type { TenantContext } from "../../types";
import { assertWithinLimit } from "../subscriptions/limits";
import {
  bumpMenuVersionOfBranch,
  categoryHasProducts,
  findCategory,
  findMenu,
  findProduct,
  guardFailure,
  insertCategory,
  insertMenu,
  insertProduct,
  listCategories,
  listCategoryProducts,
  readMenuTree,
  readProduct,
  renameCategory,
  reorderCategories as reorderCategoryRows,
  reorderProducts as reorderProductRows,
  setProductAvailability,
  softDeleteCategory,
  softDeleteProduct,
  updateProduct as updateProductRow,
  type CategoryView,
  type GroupRowWithOption,
  type GuardReason,
  type MenuView,
  type ProductChanges,
  type ProductChildren,
  type ProductView,
} from "./catalog.repository";

/** Dependencias de un servicio con tenant; las arma `deps(c)` en las rutas. */
export type CatalogDeps = { db: Db; tenant: TenantContext; requestId: string };

export const CATEGORY_VERSION_CONFLICT =
  "Alguien más cambió esta categoría mientras la editabas. Actualiza la página y vuelve a intentarlo.";
export const PRODUCT_VERSION_CONFLICT =
  "Alguien más cambió este producto mientras lo editabas. Actualiza la página y vuelve a intentarlo.";
export const ORDER_CONFLICT =
  "La lista cambió mientras la ordenabas (se agregó o se borró algo). Actualiza la página y vuelve a ordenar.";
export const CATEGORY_IN_USE =
  "Esta categoría todavía tiene productos. Muévelos a otra categoría o bórralos antes de borrarla.";
export const CATEGORY_NOT_FOUND = "La categoría no existe o ya se borró. Elige otra.";
export const CATEGORIES_LIMIT_MESSAGE = `Un menú admite hasta ${MAX_CATEGORIES_PER_MENU} categorías. Junta productos en menos categorías.`;

// Menú de la sucursal ------------------------------------------------------------------------

/**
 * Menú de la sucursal. Las sucursales nuevas lo crean junto con la sucursal; las que existían
 * antes del catálogo lo crean aquí la primera vez que se necesita (sin carrera: `branch_id` es
 * único y la inserción no hace nada si ya existe).
 */
async function ensureMenu(deps: CatalogDeps, branchId: string): Promise<MenuView> {
  const existing = await findMenu(deps.db, deps.tenant, branchId);
  if (existing) return existing;
  await insertMenu(deps.db, deps.tenant, { id: newId(), branchId });
  const created = await findMenu(deps.db, deps.tenant, branchId);
  if (!created) throw new AppError("INTERNAL");
  return created;
}

/** Menú para escribir: la política de sucursal primero (staff solo las suyas), luego el menú. */
function menuForWrite(deps: CatalogDeps, branchId: string) {
  assertAllowed(canAccessBranch(deps.tenant, branchId));
  return ensureMenu(deps, branchId);
}

/** Ejecuta un batch con guardas y traduce la guarda que lo abortó a un error del catálogo. */
async function guarded<T>(write: Promise<T>, errors: Partial<Record<GuardReason, AppError>>) {
  try {
    return await write;
  } catch (error) {
    const reason = guardFailure(error);
    const mapped = reason ? errors[reason] : undefined;
    throw mapped ?? error;
  }
}

/**
 * Sentencia que crea el menú vacío de una sucursal nueva, para el mismo `db.batch` que la
 * inserta (T15 → T16).
 */
export function newMenuStatement(db: Db, tenant: TenantContext, branchId: string) {
  return insertMenu(db, tenant, { id: newId(), branchId });
}

/**
 * Sentencia que sube `menu_version` del menú de la sucursal, para el `db.batch` de otro módulo
 * que cambia el menú público (zonas de entrega, ADR-018).
 */
export function menuVersionBumpStatement(db: Db, tenant: TenantContext, branchId: string) {
  return bumpMenuVersionOfBranch(db, tenant, branchId);
}

function logEvent(deps: CatalogDeps, event: string, data: Record<string, string>) {
  log.info(event, { requestId: deps.requestId, orgId: deps.tenant.orgId, ...data });
}

// Mappers -----------------------------------------------------------------------------------

function toCategoryDto(row: CategoryView): CategoryDto {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toProductDto(
  row: ProductView,
  variants: VariantDto[],
  optionGroups: OptionGroupDto[],
): ProductDto {
  return {
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    available: row.available,
    position: row.position,
    version: row.version,
    variants,
    optionGroups,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Filas de grupo × opción (ya ordenadas) → grupos con sus opciones, por producto. */
function groupsByProduct(rows: readonly GroupRowWithOption[]) {
  const byProduct = new Map<string, OptionGroupDto[]>();
  const byId = new Map<string, OptionGroupDto>();
  for (const { group, option } of rows) {
    let dto = byId.get(group.id);
    if (!dto) {
      dto = {
        id: group.id,
        name: group.name,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        position: group.position,
        options: [],
      };
      byId.set(group.id, dto);
      const list = byProduct.get(group.productId) ?? [];
      list.push(dto);
      byProduct.set(group.productId, list);
    }
    if (option) dto.options.push(option);
  }
  return byProduct;
}

// Lectura -----------------------------------------------------------------------------------

/** Menú completo del panel: categorías en orden, con productos (incluye no disponibles). */
export async function getMenu(deps: CatalogDeps, branchId: string): Promise<MenuDto> {
  assertAllowed(canAccessBranch(deps.tenant, branchId));
  const tree = await readMenuTree(deps.db, deps.tenant, branchId);
  // Sucursal anterior al catálogo: se crea su menú vacío.
  const menu = tree.menu ?? (await ensureMenu(deps, branchId));

  const variantsByProduct = new Map<string, VariantDto[]>();
  const productRows: ProductView[] = [];
  for (const { product, variant } of tree.productRows) {
    let variants = variantsByProduct.get(product.id);
    if (!variants) {
      variants = [];
      variantsByProduct.set(product.id, variants);
      productRows.push(product);
    }
    if (variant) variants.push(variant);
  }
  const groups = groupsByProduct(tree.groupRows);

  const productsByCategory = new Map<string, ProductDto[]>();
  for (const product of productRows) {
    const list = productsByCategory.get(product.categoryId) ?? [];
    list.push(
      toProductDto(product, variantsByProduct.get(product.id) ?? [], groups.get(product.id) ?? []),
    );
    productsByCategory.set(product.categoryId, list);
  }

  return {
    id: menu.id,
    branchId: menu.branchId,
    status: menu.status,
    slug: menu.slug,
    publishedAt: menu.publishedAt?.toISOString() ?? null,
    menuVersion: menu.menuVersion,
    categories: tree.categoryRows.map((category) => ({
      ...toCategoryDto(category),
      products: productsByCategory.get(category.id) ?? [],
    })),
  };
}

// Categorías --------------------------------------------------------------------------------

export async function createCategory(
  deps: CatalogDeps,
  branchId: string,
  input: CreateCategoryInput,
): Promise<CategoryDto> {
  const menu = await menuForWrite(deps, branchId);
  const existing = await listCategories(deps.db, deps.tenant, menu.id);
  if (existing.length >= MAX_CATEGORIES_PER_MENU) {
    throw new AppError("BUSINESS_RULE", CATEGORIES_LIMIT_MESSAGE);
  }
  const row = await insertCategory(deps.db, deps.tenant, menu.id, {
    id: newId(),
    name: input.name,
  });
  if (!row) throw new AppError("INTERNAL");
  logEvent(deps, "catalog.category_created", { branchId, categoryId: row.id });
  return toCategoryDto(row);
}

export async function updateCategory(
  deps: CatalogDeps,
  branchId: string,
  categoryId: string,
  input: UpdateCategoryInput,
): Promise<CategoryDto> {
  const menu = await menuForWrite(deps, branchId);
  const current = await findCategory(deps.db, deps.tenant, menu.id, categoryId);
  if (!current) throw new AppError("NOT_FOUND");
  const conflict = new AppError("CONFLICT", CATEGORY_VERSION_CONFLICT);
  if (current.version !== input.version) throw conflict;

  const row = await guarded(
    renameCategory(deps.db, deps.tenant, menu.id, categoryId, input.version, input.name),
    { version: conflict },
  );
  if (!row) throw conflict;
  logEvent(deps, "catalog.category_updated", { branchId, categoryId });
  return toCategoryDto(row);
}

/** Borrado lógico. Con productos no borrados (aunque no estén disponibles) → `BUSINESS_RULE`. */
export async function deleteCategory(
  deps: CatalogDeps,
  branchId: string,
  categoryId: string,
  now = new Date(),
) {
  const menu = await menuForWrite(deps, branchId);
  const current = await findCategory(deps.db, deps.tenant, menu.id, categoryId);
  if (!current) throw new AppError("NOT_FOUND");
  const inUse = new AppError("BUSINESS_RULE", CATEGORY_IN_USE);
  if (await categoryHasProducts(deps.db, deps.tenant, categoryId)) throw inUse;

  await guarded(softDeleteCategory(deps.db, deps.tenant, menu.id, categoryId, now), {
    missing: new AppError("NOT_FOUND"),
    category_in_use: inUse,
  });
  logEvent(deps, "catalog.category_deleted", { branchId, categoryId });
}

/** `ids` debe ser exactamente el conjunto de elementos no borrados; si no → `CONFLICT`. */
function assertSameSet(current: readonly { id: string }[], ids: readonly string[]) {
  const known = new Set(current.map((item) => item.id));
  if (known.size !== ids.length || ids.some((id) => !known.has(id))) {
    throw new AppError("CONFLICT", ORDER_CONFLICT);
  }
}

function toReorderResult(rows: ReorderResultDto["items"]): ReorderResultDto {
  const items = [...rows];
  items.sort((a, b) => a.position - b.position);
  return { items };
}

export async function reorderCategories(
  deps: CatalogDeps,
  branchId: string,
  input: ReorderInput,
): Promise<ReorderResultDto> {
  const menu = await menuForWrite(deps, branchId);
  assertSameSet(await listCategories(deps.db, deps.tenant, menu.id), input.ids);
  const rows = await reorderCategoryRows(deps.db, deps.tenant, menu.id, input.ids);
  logEvent(deps, "catalog.categories_reordered", { branchId });
  return toReorderResult(rows);
}

export async function reorderProducts(
  deps: CatalogDeps,
  branchId: string,
  categoryId: string,
  input: ReorderInput,
): Promise<ReorderResultDto> {
  const menu = await menuForWrite(deps, branchId);
  if (!(await findCategory(deps.db, deps.tenant, menu.id, categoryId))) {
    throw new AppError("NOT_FOUND");
  }
  assertSameSet(await listCategoryProducts(deps.db, deps.tenant, categoryId), input.ids);
  const rows = await reorderProductRows(deps.db, deps.tenant, menu.id, categoryId, input.ids);
  logEvent(deps, "catalog.products_reordered", { branchId, categoryId });
  return toReorderResult(rows);
}

// Productos ---------------------------------------------------------------------------------

function variantRows(productId: string, variants: readonly VariantInput[]) {
  return variants.map((variant, position) => ({
    id: newId(),
    productId,
    name: variant.name,
    priceCents: variant.priceCents,
    position,
  }));
}

function optionGroupRows(
  productId: string,
  groups: readonly OptionGroupInput[],
): Pick<ProductChildren, "groups" | "options"> {
  const groupRows: ProductChildren["groups"] = [];
  const optionRows: ProductChildren["options"] = [];
  groups.forEach((group, position) => {
    const optionGroupId = newId();
    groupRows.push({
      id: optionGroupId,
      productId,
      name: group.name,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      position,
    });
    group.options.forEach((option, optionPosition) => {
      optionRows.push({
        id: newId(),
        optionGroupId,
        name: option.name,
        priceDeltaCents: option.priceDeltaCents,
        position: optionPosition,
      });
    });
  });
  return { groups: groupRows, options: optionRows };
}

/** Descripción vacía = sin descripción. */
function descriptionValue(description: string | null) {
  return description === null || description === "" ? null : description;
}

async function productDto(deps: CatalogDeps, menuId: string, productId: string) {
  const found = await readProduct(deps.db, deps.tenant, menuId, productId);
  if (!found) throw new AppError("NOT_FOUND");
  const groups = groupsByProduct(found.groupRows).get(productId) ?? [];
  return toProductDto(found.product, found.variantRows, groups);
}

const categoryMissing = () =>
  new AppError("NOT_FOUND", CATEGORY_NOT_FOUND, { categoryId: [CATEGORY_NOT_FOUND] });

/** Producto nuevo al final de su categoría. Respeta el límite de productos del plan. */
export async function createProduct(
  deps: CatalogDeps,
  branchId: string,
  input: CreateProductInput,
): Promise<ProductDto> {
  const menu = await menuForWrite(deps, branchId);
  if (!(await findCategory(deps.db, deps.tenant, menu.id, input.categoryId))) {
    throw categoryMissing();
  }
  await assertWithinLimit(deps, "products");

  const productId = newId();
  await guarded(
    insertProduct(
      deps.db,
      deps.tenant,
      menu.id,
      {
        id: productId,
        categoryId: input.categoryId,
        name: input.name,
        description: descriptionValue(input.description ?? null),
        priceCents: input.priceCents,
        available: input.available ?? true,
      },
      {
        variants: variantRows(productId, input.variants ?? []),
        ...optionGroupRows(productId, input.optionGroups ?? []),
      },
    ),
    { missing: categoryMissing() },
  );
  logEvent(deps, "catalog.product_created", { branchId, productId });
  return productDto(deps, menu.id, productId);
}

/**
 * Cambios parciales con concurrencia optimista. `variants` y `optionGroups` presentes reemplazan
 * la lista completa; otra `categoryId` mueve el producto al final de esa categoría.
 */
export async function updateProduct(
  deps: CatalogDeps,
  branchId: string,
  productId: string,
  input: UpdateProductInput,
): Promise<ProductDto> {
  const menu = await menuForWrite(deps, branchId);
  const current = await findProduct(deps.db, deps.tenant, menu.id, productId);
  if (!current) throw new AppError("NOT_FOUND");
  const conflict = new AppError("CONFLICT", PRODUCT_VERSION_CONFLICT);
  if (current.version !== input.version) throw conflict;

  const moveTo =
    input.categoryId !== undefined && input.categoryId !== current.categoryId
      ? input.categoryId
      : undefined;
  if (moveTo && !(await findCategory(deps.db, deps.tenant, menu.id, moveTo))) {
    throw categoryMissing();
  }

  const changes: ProductChanges = {
    name: input.name,
    description: input.description === undefined ? undefined : descriptionValue(input.description),
    priceCents: input.priceCents,
    available: input.available,
  };
  await guarded(
    updateProductRow(deps.db, deps.tenant, menu.id, productId, input.version, {
      changes,
      moveTo,
      variants: input.variants ? variantRows(productId, input.variants) : undefined,
      optionGroups: input.optionGroups ? optionGroupRows(productId, input.optionGroups) : undefined,
    }),
    { version: conflict, missing: categoryMissing() },
  );
  logEvent(deps, "catalog.product_updated", { branchId, productId });
  return productDto(deps, menu.id, productId);
}

/** Disponibilidad (agotado / disponible): la única edición de producto que puede hacer `staff`. */
export async function setAvailability(
  deps: CatalogDeps,
  branchId: string,
  productId: string,
  input: ProductAvailabilityInput,
): Promise<ProductDto> {
  const menu = await menuForWrite(deps, branchId);
  const current = await findProduct(deps.db, deps.tenant, menu.id, productId);
  if (!current) throw new AppError("NOT_FOUND");
  const conflict = new AppError("CONFLICT", PRODUCT_VERSION_CONFLICT);
  if (current.version !== input.version) throw conflict;

  await guarded(
    setProductAvailability(
      deps.db,
      deps.tenant,
      menu.id,
      productId,
      input.version,
      input.available,
    ),
    { version: conflict },
  );
  logEvent(deps, "catalog.product_availability_changed", { branchId, productId });
  return productDto(deps, menu.id, productId);
}

/** Borrado lógico: deja de aparecer, pero la fila queda para los pedidos. */
export async function deleteProduct(
  deps: CatalogDeps,
  branchId: string,
  productId: string,
  now = new Date(),
) {
  const menu = await menuForWrite(deps, branchId);
  await guarded(softDeleteProduct(deps.db, deps.tenant, menu.id, productId, now), {
    missing: new AppError("NOT_FOUND"),
  });
  logEvent(deps, "catalog.product_deleted", { branchId, productId });
}
