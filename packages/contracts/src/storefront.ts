import { z } from "zod";
import { BranchModes, HoursRangeDto } from "./businesses";
import { MenuStatus } from "./catalog";

// Storefront (T18, ADR-008, ADR-014): tema del menú público, enlace (slug), publicación y la
// lectura pública por slug. Presets y fuentes de `apps/web/DESIGN.md §3.2–3.3`.

export const THEME_PRESETS = ["minimal", "dark", "vibrant"] as const;
export const ThemePreset = z.enum(THEME_PRESETS);
export type ThemePreset = z.infer<typeof ThemePreset>;

/** Colores de cada preset (`DESIGN.md §3.2`): `--brand`, `--brand-bg` y `--brand-text`. */
export const THEME_PRESET_COLORS = {
  minimal: { primaryColor: "#1C1F1A", backgroundColor: "#FFFFFF", textColor: "#1C1F1A" },
  dark: { primaryColor: "#F5A300", backgroundColor: "#17191A", textColor: "#F2F2EE" },
  vibrant: { primaryColor: "#C2185B", backgroundColor: "#FFF8F2", textColor: "#2A1A12" },
} as const satisfies Record<
  ThemePreset,
  { primaryColor: string; backgroundColor: string; textColor: string }
>;

/** `sans` = Onest, `rounded` = Nunito, `serif` = Source Serif 4 (`DESIGN.md §3.3`). */
export const FONT_PRESETS = ["sans", "rounded", "serif"] as const;
export const FontPreset = z.enum(FONT_PRESETS);
export type FontPreset = z.infer<typeof FontPreset>;

/** Cómo se acomodan los productos en el menú público. */
export const PRODUCT_LAYOUTS = ["list", "grid"] as const;
export const ProductLayout = z.enum(PRODUCT_LAYOUTS);
export type ProductLayout = z.infer<typeof ProductLayout>;

/** Valores del tema sin personalizar (sin fila guardada o sin la capacidad `customTheme`). */
export const DEFAULT_THEME = {
  preset: "minimal",
  fontPreset: "sans",
  productLayout: "list",
} as const satisfies { preset: ThemePreset; fontPreset: FontPreset; productLayout: ProductLayout };

/** Contraste mínimo WCAG AA para texto normal. */
export const MIN_CONTRAST_RATIO = 4.5;

/** Color `#RRGGBB`; se guarda en mayúsculas. */
export const HexColor = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, { message: "Usa un color en formato #RRGGBB, por ejemplo #1F5C45." })
  .toUpperCase();

// Slug --------------------------------------------------------------------------------------

/** Rutas de WEB y de la API que un negocio no puede usar como enlace. */
export const RESERVED_SLUGS = [
  "app",
  "api",
  "admin",
  "m",
  "pedido",
  "crear",
  "entrar",
  "docs",
  "webhooks",
  "invitacion",
  "verificar-correo",
  "restablecer",
] as const;

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 50;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_FORMAT_MESSAGE =
  "Usa de 3 a 50 letras minúsculas sin acentos, números y guiones, por ejemplo tacos-el-guero.";
export const SLUG_RESERVED_MESSAGE = "Ese enlace está reservado. Elige otro.";

export const Slug = z
  .string()
  .trim()
  .min(SLUG_MIN_LENGTH, { message: SLUG_FORMAT_MESSAGE })
  .max(SLUG_MAX_LENGTH, { message: SLUG_FORMAT_MESSAGE })
  .regex(SLUG_PATTERN, { message: SLUG_FORMAT_MESSAGE })
  .refine((slug) => !(RESERVED_SLUGS as readonly string[]).includes(slug), {
    message: SLUG_RESERVED_MESSAGE,
  });

/** Slug de la ruta pública. Uno con formato inválido no existe (404). */
export const PublicMenuParams = z.strictObject({
  slug: z.string().min(1).max(SLUG_MAX_LENGTH).regex(SLUG_PATTERN),
});

/** Solo mientras el menú nunca se ha publicado: después el enlace ya está en QR impresos. */
export const UpdateSlugInput = z.strictObject({ slug: Slug });
export type UpdateSlugInput = z.infer<typeof UpdateSlugInput>;

// Tema --------------------------------------------------------------------------------------

/**
 * Cambios al tema del menú. Lo omitido conserva lo guardado; `null` en un color o una imagen
 * vuelve al valor del preset (o la quita). `version` es la del tema leído (`0` si nunca se
 * guardó; omitirla equivale a `0`): otra → `CONFLICT`.
 *
 * Sin la capacidad `customTheme` (plan `free`) solo se aceptan `preset` y `primaryColor`; poner
 * `showBranding: false` exige `removeBranding`. Si no, `PLAN_LIMIT_REACHED`.
 */
export const UpdateThemeInput = z.strictObject({
  version: z.int().nonnegative().optional(),
  preset: ThemePreset.optional(),
  primaryColor: HexColor.nullable().optional(),
  backgroundColor: HexColor.nullable().optional(),
  textColor: HexColor.nullable().optional(),
  fontPreset: FontPreset.optional(),
  productLayout: ProductLayout.optional(),
  logoAssetId: z.uuidv7().nullable().optional(),
  coverAssetId: z.uuidv7().nullable().optional(),
  showBranding: z.boolean().optional(),
});
export type UpdateThemeInput = z.infer<typeof UpdateThemeInput>;

/**
 * Tema guardado, para el panel. Un color en `null` sigue al preset (`THEME_PRESET_COLORS`). Es lo
 * guardado, no lo que ve el comensal: sin `customTheme`, el menú público usa solo el preset y
 * el color principal. `version: 0` = todavía no se guarda ningún tema.
 */
export const ThemeDto = z
  .strictObject({
    preset: ThemePreset,
    primaryColor: z.string().nullable(),
    backgroundColor: z.string().nullable(),
    textColor: z.string().nullable(),
    fontPreset: FontPreset,
    productLayout: ProductLayout,
    logoAssetId: z.uuidv7().nullable(),
    logoUrl: z.url().nullable(),
    coverAssetId: z.uuidv7().nullable(),
    coverUrl: z.url().nullable(),
    showBranding: z.boolean(),
    version: z.int().nonnegative(),
    updatedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: "ThemeDto" });
export type ThemeDto = z.infer<typeof ThemeDto>;

// Publicación -------------------------------------------------------------------------------

/** Estado de publicación del menú tras cambiar el slug, publicar o despublicar. */
export const MenuPublicationDto = z
  .strictObject({
    status: MenuStatus,
    slug: z.string().nullable(),
    publishedAt: z.iso.datetime().nullable(),
    menuVersion: z.int().positive(),
  })
  .meta({ id: "MenuPublicationDto" });
export type MenuPublicationDto = z.infer<typeof MenuPublicationDto>;

// Lectura pública ---------------------------------------------------------------------------

/**
 * Por qué el menú no recibe pedidos: no publicado, suscripción suspendida, ningún dueño con correo
 * verificado (ADR-008) o sucursal cerrada. Si hay varios, se informa el primero de esta lista.
 */
export const NOT_ACCEPTING_REASONS = ["unpublished", "suspended", "unverified", "closed"] as const;
export const NotAcceptingReason = z.enum(NOT_ACCEPTING_REASONS);
export type NotAcceptingReason = z.infer<typeof NotAcceptingReason>;

/** Tema efectivo según el plan vigente, con las URLs de sus imágenes. */
export const PublicThemeDto = z
  .strictObject({
    preset: ThemePreset,
    primaryColor: z.string(),
    backgroundColor: z.string(),
    textColor: z.string(),
    fontPreset: FontPreset,
    productLayout: ProductLayout,
    logoUrl: z.url().nullable(),
    coverUrl: z.url().nullable(),
    /** Sello "Hecho con MenusMax"; solo se oculta con la capacidad `removeBranding`. */
    showBranding: z.boolean(),
  })
  .meta({ id: "PublicThemeDto" });
export type PublicThemeDto = z.infer<typeof PublicThemeDto>;

export const PublicOptionDto = z
  .strictObject({ id: z.uuidv7(), name: z.string(), priceDeltaCents: z.int() })
  .meta({ id: "PublicOptionDto" });

export const PublicOptionGroupDto = z
  .strictObject({
    id: z.uuidv7(),
    name: z.string(),
    minSelect: z.int(),
    maxSelect: z.int(),
    options: z.array(PublicOptionDto),
  })
  .meta({ id: "PublicOptionGroupDto" });

export const PublicVariantDto = z
  .strictObject({ id: z.uuidv7(), name: z.string(), priceCents: z.int() })
  .meta({ id: "PublicVariantDto" });

/** Solo productos disponibles y no borrados. */
export const PublicProductDto = z
  .strictObject({
    id: z.uuidv7(),
    name: z.string(),
    description: z.string().nullable(),
    priceCents: z.int(),
    imageUrl: z.url().nullable(),
    imageWidth: z.int().positive().nullable(),
    imageHeight: z.int().positive().nullable(),
    variants: z.array(PublicVariantDto),
    optionGroups: z.array(PublicOptionGroupDto),
  })
  .meta({ id: "PublicProductDto" });
export type PublicProductDto = z.infer<typeof PublicProductDto>;

/** Categorías con al menos un producto disponible, en orden. */
export const PublicCategoryDto = z
  .strictObject({ id: z.uuidv7(), name: z.string(), products: z.array(PublicProductDto) })
  .meta({ id: "PublicCategoryDto" });
export type PublicCategoryDto = z.infer<typeof PublicCategoryDto>;

/** Zona de entrega activa: nombre y tarifa; los códigos postales nunca salen (ADR-018). */
export const PublicDeliveryZoneDto = z
  .strictObject({ name: z.string(), feeCents: z.int().nonnegative() })
  .meta({ id: "PublicDeliveryZoneDto" });

export const PublicBranchDto = z
  .strictObject({
    name: z.string(),
    timezone: z.string(),
    contactPhone: z.string().nullable(),
    /** Rangos de hoy en la hora local de la sucursal. */
    todayHours: z.array(HoursRangeDto.omit({ weekday: true })),
    isOpen: z.boolean(),
    /** Próxima apertura si está cerrada y tiene horario; si no, `null`. */
    nextOpening: z.iso.datetime().nullable(),
    /** `delivery` solo es `true` si hay al menos una zona activa (ADR-018). */
    modes: BranchModes,
    /** Mesas válidas: de la 1 a `tableCount`; `0` si no atiende en mesa. */
    tableCount: z.int().nonnegative(),
    deliveryZones: z.array(PublicDeliveryZoneDto),
  })
  .meta({ id: "PublicBranchDto" });

/**
 * Menú publicado para el comensal: solo datos publicables, sin ids de organización, sucursal ni
 * menú, sin códigos postales, sin el número de avisos de WhatsApp y sin datos de miembros.
 */
export const PublicMenuDto = z
  .strictObject({
    slug: z.string(),
    menuVersion: z.int().positive(),
    business: z.strictObject({ name: z.string() }),
    branch: PublicBranchDto,
    theme: PublicThemeDto,
    categories: z.array(PublicCategoryDto),
    acceptingOrders: z.boolean(),
    /** `null` si `acceptingOrders` es `true`. */
    notAcceptingReason: NotAcceptingReason.nullable(),
  })
  .meta({ id: "PublicMenuDto" });
export type PublicMenuDto = z.infer<typeof PublicMenuDto>;

/** Lectura mínima para la llave de caché `menu:{slug}:v{menuVersion}` en WEB (ADR-014). */
export const PublicMenuVersionDto = z
  .strictObject({ menuVersion: z.int().positive() })
  .meta({ id: "PublicMenuVersionDto" });
export type PublicMenuVersionDto = z.infer<typeof PublicMenuVersionDto>;
