import {
  SUBSCRIPTION_STATUSES,
  type FontPreset,
  type MenuPublicationDto,
  type ProductLayout,
  type PublicCategoryDto,
  type PublicMenuDto,
  type PublicMenuVersionDto,
  type PublicProductDto,
  type SubscriptionStatus,
  type ThemeDto,
  type ThemePreset,
  type UpdateSlugInput,
  type UpdateThemeInput,
} from "@menu-max/contracts";
import { renderSVG } from "uqr";
import type { Env } from "../../env";
import type { Db } from "../../infrastructure/db";
import { publicUrl } from "../../infrastructure/storage";
import { AppError } from "../../shared/errors";
import { newId } from "../../shared/ids";
import { log } from "../../shared/log";
import { canAccessBranch } from "../../shared/authz/policies";
import { assertAllowed } from "../../shared/authz/result";
import type { TenantContext } from "../../types";
import { isOpen, localWeekday, nextOpening, type HoursRange } from "../businesses/hours";
import { menuOfBranch } from "../catalog/catalog.service";
import { findMedia } from "../catalog/media.service";
import { assertFeature } from "../subscriptions/limits";
import { acceptingOrders } from "./acceptance";
import {
  assignSlug,
  bumpMenusOwnedBy,
  findAssetKeys,
  findBusinessNameOfBranch,
  findPublication,
  findPublicMenuVersion,
  findQrTarget,
  findTakenSlugs,
  findTheme,
  publishMenu,
  readPublicMenu,
  saveTheme,
  unpublishMenu,
  updateSlug,
  type PublicationView,
  type ThemeView,
} from "./storefront.repository";
import {
  contrastErrors,
  customizedFields,
  DEFAULT_STORED_THEME,
  effectiveTheme,
  firstFreeSlug,
  slugBase,
  themeColors,
  type StoredTheme,
} from "./theme";

// Storefront (T18): tema, slug y publicación desde el panel, y lectura pública por slug.

export type StorefrontDeps = {
  db: Db;
  env: Pick<Env, "MEDIA_PUBLIC_BASE_URL" | "WEB_ORIGIN">;
  tenant: TenantContext;
  requestId: string;
};

export type PublicStorefrontDeps = {
  db: Db;
  env: Pick<Env, "MEDIA_PUBLIC_BASE_URL">;
  requestId: string;
};

export const THEME_VERSION_CONFLICT =
  "Alguien más cambió el tema mientras lo editabas. Actualiza la página y vuelve a intentarlo.";
export const SLUG_LOCKED = "El enlace ya está en tus QR impresos y no se puede cambiar.";
export const SLUG_TAKEN = "Ese enlace ya está en uso. Prueba con otro.";
export const NO_AVAILABLE_PRODUCTS = "Agrega al menos un producto disponible antes de publicar.";
export const IMAGE_NOT_FOUND = "La imagen no existe o ya se borró. Sube otra.";

const SLUG_ATTEMPTS = 3;

function logEvent(deps: StorefrontDeps, event: string, data: Record<string, string>) {
  log.info(event, { requestId: deps.requestId, orgId: deps.tenant.orgId, ...data });
}

// Slug --------------------------------------------------------------------------------------

/** ¿El error es el índice único de `menus.slug`? (dos menús tomaron el mismo slug a la vez) */
export function isSlugTaken(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    if (/UNIQUE constraint failed: menus\.slug/.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}

/** Primer slug libre para el nombre del negocio ("Tacos El Güero" → `tacos-el-guero`, `-2`…). */
export async function availableSlug(db: Db, businessName: string): Promise<string> {
  const base = slugBase(businessName);
  return firstFreeSlug(base, await findTakenSlugs(db, base));
}

/**
 * Ejecuta `write` con un slug libre; si otro menú lo tomó entre la lectura y la escritura,
 * vuelve a calcularlo (hasta 3 intentos). Para crear una sucursal con su menú (T15) o asignar el
 * slug de un menú que no tiene.
 */
export async function withAvailableSlug<T>(
  db: Db,
  businessName: string,
  write: (slug: string) => Promise<T>,
  attempt = 1,
): Promise<T> {
  const slug = await availableSlug(db, businessName);
  try {
    return await write(slug);
  } catch (error) {
    if (attempt >= SLUG_ATTEMPTS || !isSlugTaken(error)) throw error;
    return withAvailableSlug(db, businessName, write, attempt + 1);
  }
}

type MenuRef = { id: string; branchId: string };

/** Menú de la sucursal (con `canAccessBranch`) y su publicación; sin slug, se le asigna uno. */
async function loadMenu(deps: StorefrontDeps, branchId: string) {
  const menu: MenuRef & PublicationView = await menuOfBranch(deps, branchId);
  if (menu.slug !== null) return menu;
  const name = await findBusinessNameOfBranch(deps.db, deps.tenant, branchId);
  if (name === undefined) throw new AppError("NOT_FOUND");
  const assigned = await withAvailableSlug(deps.db, name, (slug) =>
    assignSlug(deps.db, deps.tenant, menu.id, slug),
  );
  // Sin filas: otra petición le asignó slug primero.
  const current = assigned[0] ?? (await findPublication(deps.db, deps.tenant, menu.id));
  if (!current) throw new AppError("NOT_FOUND");
  return { ...menu, ...current };
}

function toPublicationDto(row: PublicationView): MenuPublicationDto {
  return {
    status: row.status,
    slug: row.slug,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    menuVersion: row.menuVersion,
  };
}

/**
 * Cambia el enlace del menú. Solo mientras nunca se ha publicado: después ya está en QR
 * impresos (`BUSINESS_RULE`). Tomado por otro menú → `CONFLICT`.
 */
export async function changeSlug(
  deps: StorefrontDeps,
  branchId: string,
  input: UpdateSlugInput,
): Promise<MenuPublicationDto> {
  const menu = await loadMenu(deps, branchId);
  const locked = new AppError("BUSINESS_RULE", SLUG_LOCKED, { slug: [SLUG_LOCKED] });
  if (menu.publishedAt !== null) throw locked;
  if (menu.slug === input.slug) return toPublicationDto(menu);

  let row: PublicationView | undefined;
  try {
    row = await updateSlug(deps.db, deps.tenant, menu.id, input.slug);
  } catch (error) {
    if (isSlugTaken(error)) throw new AppError("CONFLICT", SLUG_TAKEN, { slug: [SLUG_TAKEN] });
    throw error;
  }
  // Sin filas: se publicó entre la lectura y la escritura.
  if (!row) throw locked;
  logEvent(deps, "storefront.slug_changed", { branchId });
  return toPublicationDto(row);
}

// Publicación -------------------------------------------------------------------------------

/**
 * Publica el menú: requiere al menos un producto disponible y sube `menuVersion`. No exige
 * correo verificado (ADR-008): sin dueño verificado, el menú se ve pero `acceptingOrders` queda
 * en `false`. Ya publicado → sin cambios.
 */
export async function publish(
  deps: StorefrontDeps,
  branchId: string,
  now = new Date(),
): Promise<MenuPublicationDto> {
  const menu = await loadMenu(deps, branchId);
  if (menu.status === "published") return toPublicationDto(menu);
  const row = await publishMenu(deps.db, deps.tenant, menu.id, now);
  if (row) {
    logEvent(deps, "storefront.menu_published", { branchId });
    return toPublicationDto(row);
  }
  const current = await findPublication(deps.db, deps.tenant, menu.id);
  if (current?.status === "published") return toPublicationDto(current);
  throw new AppError("BUSINESS_RULE", NO_AVAILABLE_PRODUCTS);
}

/** Vuelve a borrador (el público deja de verlo) y sube `menuVersion`. Ya en borrador → sin cambios. */
export async function unpublish(
  deps: StorefrontDeps,
  branchId: string,
): Promise<MenuPublicationDto> {
  const menu = await loadMenu(deps, branchId);
  if (menu.status === "draft") return toPublicationDto(menu);
  const row = await unpublishMenu(deps.db, deps.tenant, menu.id);
  if (row) logEvent(deps, "storefront.menu_unpublished", { branchId });
  const current = row ?? (await findPublication(deps.db, deps.tenant, menu.id));
  if (!current) throw new AppError("NOT_FOUND");
  return toPublicationDto(current);
}

// QR ----------------------------------------------------------------------------------------

export const QR_MENU_NOT_PUBLISHED = "Publica tu menú para descargar el QR.";
export const QR_NO_TABLES =
  "Esta sucursal no tiene mesas. Indica cuántas tiene en los datos de la sucursal.";

/** ADR-017: corrección de errores nivel M y margen de 4 módulos (la zona silenciosa del estándar). */
export const QR_OPTIONS = { ecc: "M", border: 4 } as const;

function qrTableError(tableCount: number) {
  const message = tableCount === 0 ? QR_NO_TABLES : `Elige una mesa de la 1 a la ${tableCount}.`;
  return new AppError("VALIDATION_FAILED", message, { mesa: [message] });
}

/** Destino del QR: `/m/{slug}` o `/m/{slug}?mesa={n}` en WEB. */
export function qrUrl(webOrigin: string, slug: string, mesa?: number): string {
  const url = new URL(`/m/${slug}`, webOrigin);
  if (mesa !== undefined) url.searchParams.set("mesa", String(mesa));
  return url.href;
}

/**
 * SVG del QR del menú publicado o de una de sus mesas (ADR-017). Se genera al pedirlo: solo
 * depende del slug, que no cambia tras publicar, así que el QR impreso y el del panel coinciden.
 * Menú no publicado (borrador o despublicado) → `BUSINESS_RULE`.
 */
export async function getMenuQr(
  deps: StorefrontDeps,
  branchId: string,
  mesa?: number,
): Promise<string> {
  assertAllowed(canAccessBranch(deps.tenant, branchId));
  const target = await findQrTarget(deps.db, deps.tenant, branchId);
  if (!target) throw new AppError("NOT_FOUND");
  if (mesa !== undefined && mesa > target.tableCount) throw qrTableError(target.tableCount);
  if (target.status !== "published" || target.slug === null) {
    throw new AppError("BUSINESS_RULE", QR_MENU_NOT_PUBLISHED);
  }
  return renderSVG(qrUrl(deps.env.WEB_ORIGIN, target.slug, mesa), QR_OPTIONS);
}

// Tema --------------------------------------------------------------------------------------

function storedOf(row: ThemeView | undefined): StoredTheme {
  if (!row) return DEFAULT_STORED_THEME;
  return {
    preset: row.preset,
    primaryColor: row.primaryColor,
    backgroundColor: row.backgroundColor,
    textColor: row.textColor,
    fontPreset: row.fontPreset,
    productLayout: row.productLayout,
    logoAssetId: row.logoAssetId,
    coverAssetId: row.coverAssetId,
    showBranding: row.showBranding,
  };
}

async function toThemeDto(deps: StorefrontDeps, row: ThemeView | undefined): Promise<ThemeDto> {
  const theme = storedOf(row);
  const ids = [theme.logoAssetId, theme.coverAssetId].filter((id): id is string => id !== null);
  const keys = await findAssetKeys(deps.db, deps.tenant, ids);
  const url = (id: string | null) => {
    const key = id === null ? undefined : keys.get(id);
    return key === undefined ? null : publicUrl(deps.env, key);
  };
  return {
    ...theme,
    logoUrl: url(theme.logoAssetId),
    coverUrl: url(theme.coverAssetId),
    version: row?.version ?? 0,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

/** Tema guardado del menú; sin guardar, el de por defecto con `version: 0`. */
export async function getTheme(deps: StorefrontDeps, branchId: string): Promise<ThemeDto> {
  const menu = await loadMenu(deps, branchId);
  return toThemeDto(deps, await findTheme(deps.db, deps.tenant, menu.id));
}

/** Lo enviado sobre lo guardado: omitido = se conserva; `null` = vuelve al preset o se quita. */
function mergeTheme(current: StoredTheme, input: UpdateThemeInput): StoredTheme {
  const pick = <K extends keyof StoredTheme>(key: K): StoredTheme[K] => {
    const value = input[key] as StoredTheme[K] | undefined;
    return value === undefined ? current[key] : value;
  };
  return {
    preset: pick("preset") as ThemePreset,
    primaryColor: pick("primaryColor"),
    backgroundColor: pick("backgroundColor"),
    textColor: pick("textColor"),
    fontPreset: pick("fontPreset") as FontPreset,
    productLayout: pick("productLayout") as ProductLayout,
    logoAssetId: pick("logoAssetId"),
    coverAssetId: pick("coverAssetId"),
    showBranding: pick("showBranding"),
  };
}

const imageMissing = (field: "logoAssetId" | "coverAssetId") =>
  new AppError("NOT_FOUND", IMAGE_NOT_FOUND, { [field]: [IMAGE_NOT_FOUND] });

/**
 * Guarda el tema y sube `menuVersion`. Reglas, en orden: capacidades del plan (`customTheme`,
 * `removeBranding`) → `PLAN_LIMIT_REACHED`; imágenes de la organización → `NOT_FOUND`; contraste
 * AA del tema que verá el comensal → `VALIDATION_FAILED` con el color que hay que cambiar;
 * `version` vieja → `CONFLICT`.
 */
export async function updateTheme(
  deps: StorefrontDeps,
  branchId: string,
  input: UpdateThemeInput,
): Promise<ThemeDto> {
  const menu = await loadMenu(deps, branchId);
  const row = await findTheme(deps.db, deps.tenant, menu.id);
  const expectedVersion = input.version ?? 0;
  const conflict = new AppError("CONFLICT", THEME_VERSION_CONFLICT);
  if ((row?.version ?? 0) !== expectedVersion) throw conflict;

  if (customizedFields(input).length > 0) assertFeature(deps, "customTheme");
  if (input.showBranding === false) assertFeature(deps, "removeBranding");
  const assetFields = (["logoAssetId", "coverAssetId"] as const).filter((field) => input[field]);
  const assets = await Promise.all(
    assetFields.map((field) => findMedia(deps, input[field] as string)),
  );
  const missing = assetFields.find((_, index) => !assets[index]);
  if (missing) throw imageMissing(missing);

  const theme = mergeTheme(storedOf(row), input);
  const errors = contrastErrors(themeColors(theme, deps.tenant.plan.features));
  if (errors) {
    throw new AppError(
      "VALIDATION_FAILED",
      "Los colores no contrastan lo suficiente con el fondo. Cambia el color que se indica.",
      errors,
    );
  }

  const saved = await saveTheme(deps.db, deps.tenant, menu.id, expectedVersion, theme, newId());
  if (!saved) throw conflict;
  logEvent(deps, "storefront.theme_updated", { branchId });
  return toThemeDto(deps, saved);
}

// Lectura pública ---------------------------------------------------------------------------

function isSubscriptionStatus(value: string | null): value is SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly (string | null)[]).includes(value);
}

type PublicRead = Awaited<ReturnType<typeof readPublicMenu>>;

/** Filas de producto × variante (ya ordenadas) → productos con variantes, imagen y grupos. */
function publicProducts(deps: PublicStorefrontDeps, read: PublicRead) {
  const groupsByProduct = new Map<string, PublicProductDto["optionGroups"]>();
  const groupsById = new Map<string, PublicProductDto["optionGroups"][number]>();
  for (const row of read.groupRows) {
    if (row.groupId === null || row.groupName === null) continue;
    let group = groupsById.get(row.groupId);
    if (!group) {
      group = {
        id: row.groupId,
        name: row.groupName,
        minSelect: row.minSelect,
        maxSelect: row.maxSelect,
        options: [],
      };
      groupsById.set(row.groupId, group);
      const list = groupsByProduct.get(row.productId) ?? [];
      list.push(group);
      groupsByProduct.set(row.productId, list);
    }
    if (row.optionId !== null && row.optionName !== null && row.priceDeltaCents !== null) {
      group.options.push({
        id: row.optionId,
        name: row.optionName,
        priceDeltaCents: row.priceDeltaCents,
      });
    }
  }

  const byCategory = new Map<string, PublicProductDto[]>();
  const byId = new Map<string, PublicProductDto>();
  for (const row of read.productRows) {
    let product = byId.get(row.product.id);
    if (!product) {
      const hasImage = row.imageKey !== null && row.imageWidth !== null && row.imageHeight !== null;
      product = {
        id: row.product.id,
        name: row.product.name,
        description: row.product.description,
        priceCents: row.product.priceCents,
        imageUrl: hasImage && row.imageKey ? publicUrl(deps.env, row.imageKey) : null,
        imageWidth: hasImage ? row.imageWidth : null,
        imageHeight: hasImage ? row.imageHeight : null,
        variants: [],
        optionGroups: groupsByProduct.get(row.product.id) ?? [],
      };
      byId.set(product.id, product);
      const list = byCategory.get(row.product.categoryId) ?? [];
      list.push(product);
      byCategory.set(row.product.categoryId, list);
    }
    if (row.variantId !== null && row.variantName !== null && row.variantPriceCents !== null) {
      product.variants.push({
        id: row.variantId,
        name: row.variantName,
        priceCents: row.variantPriceCents,
      });
    }
  }
  return byCategory;
}

/**
 * Al verificar su correo un dueño (ADR-008), sube `menuVersion` de los menús de sus organizaciones:
 * cambian `acceptingOrders` y, si la gracia venció, el menú vuelve a mostrarse.
 */
export function refreshMenusOfOwner(db: Db, userId: string) {
  return bumpMenusOwnedBy(db, userId);
}

/**
 * Menú publicado por su slug, en un solo `db.batch`: solo datos publicables, productos
 * disponibles y el tema efectivo según el plan vigente. Con la gracia de ADR-008 vencida, sin
 * categorías (`notAcceptingReason: "inactive"`). No publicado o inexistente → 404.
 */
export async function getPublicMenu(
  deps: PublicStorefrontDeps,
  slug: string,
  now = new Date(),
): Promise<PublicMenuDto> {
  const read = await readPublicMenu(deps.db, slug);
  const header = read.header;
  if (!header) throw new AppError("NOT_FOUND", "Este menú no existe o no está publicado.");

  const subscriptionStatus = isSubscriptionStatus(header.subscriptionStatus)
    ? header.subscriptionStatus
    : "suspended";
  if (header.subscriptionStatus === null) {
    // Toda organización tiene suscripción desde su alta (T20): sin ella, no recibe pedidos.
    log.error("subscription.missing", { requestId: deps.requestId, slug });
  }
  const features = {
    customTheme: header.customTheme === 1,
    removeBranding: header.removeBranding === 1,
  };
  const stored: StoredTheme =
    header.themePreset === null
      ? DEFAULT_STORED_THEME
      : {
          preset: header.themePreset as ThemePreset,
          primaryColor: header.themePrimaryColor,
          backgroundColor: header.themeBackgroundColor,
          textColor: header.themeTextColor,
          fontPreset: (header.themeFontPreset ?? DEFAULT_STORED_THEME.fontPreset) as FontPreset,
          productLayout: (header.themeProductLayout ??
            DEFAULT_STORED_THEME.productLayout) as ProductLayout,
          logoAssetId: null,
          coverAssetId: null,
          showBranding: header.themeShowBranding !== 0,
        };
  const theme = effectiveTheme(stored, features);
  const assetUrl = (key: string | null) => (key === null ? null : publicUrl(deps.env, key));

  const hours: HoursRange[] = read.hourRows;
  const today = localWeekday(header.timezone, now);
  const acceptance = acceptingOrders(
    { status: "published" },
    {
      hasVerifiedOwner: header.hasVerifiedOwner === 1,
      subscriptionStatus,
      createdAt: new Date(header.orgCreatedAt ?? 0),
    },
    { hours, timezone: header.timezone },
    now,
  );
  const opening = nextOpening(hours, header.timezone, now);

  // Menú inactivo (gracia vencida, ADR-008): sin categorías ni productos.
  const productsByCategory =
    acceptance.reason === "inactive"
      ? new Map<string, PublicProductDto[]>()
      : publicProducts(deps, read);
  const categories: PublicCategoryDto[] = read.categoryRows.flatMap((category) => {
    const products = productsByCategory.get(category.id) ?? [];
    return products.length > 0 ? [{ id: category.id, name: category.name, products }] : [];
  });

  return {
    slug,
    menuVersion: header.menuVersion,
    business: { name: header.businessName ?? "" },
    branch: {
      name: header.branchName ?? "",
      timezone: header.timezone,
      contactPhone: header.contactPhone,
      todayHours: hours
        .filter((range) => range.weekday === today)
        .map(({ opensAt, closesAt }) => ({ opensAt, closesAt })),
      isOpen: isOpen(hours, header.timezone, now),
      nextOpening: opening?.toISOString() ?? null,
      modes: {
        table: header.modeTable,
        pickup: header.modePickup,
        delivery: header.modeDelivery && read.zoneRows.length > 0,
      },
      tableCount: header.modeTable ? header.tableCount : 0,
      deliveryZones: header.modeDelivery ? read.zoneRows : [],
    },
    theme: {
      preset: theme.preset,
      primaryColor: theme.primaryColor,
      backgroundColor: theme.backgroundColor,
      textColor: theme.textColor,
      fontPreset: theme.fontPreset,
      productLayout: theme.productLayout,
      logoUrl: features.customTheme ? assetUrl(header.logoKey) : null,
      coverUrl: features.customTheme ? assetUrl(header.coverKey) : null,
      showBranding: theme.showBranding,
    },
    categories,
    acceptingOrders: acceptance.acceptingOrders,
    notAcceptingReason: acceptance.reason,
  };
}

/** Solo `menuVersion` del menú publicado (llave de caché en WEB, ADR-014). */
export async function getPublicMenuVersion(
  deps: PublicStorefrontDeps,
  slug: string,
): Promise<PublicMenuVersionDto> {
  const row = await findPublicMenuVersion(deps.db, slug);
  if (!row) throw new AppError("NOT_FOUND", "Este menú no existe o no está publicado.");
  return { menuVersion: row.menuVersion };
}
