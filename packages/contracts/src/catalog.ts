import { z } from "zod";

// Catálogo (T16, ADR-016): un menú por sucursal con categorías, productos, variantes y grupos de
// opciones. Todo precio es un entero en centavos (MXN implícito, como las tarifas de zona).

export const MENU_STATUSES = ["draft", "published"] as const;
export const MenuStatus = z.enum(MENU_STATUSES);
export type MenuStatus = z.infer<typeof MenuStatus>;

/** Topes técnicos del catálogo; no son límites del plan (el plan solo limita productos). */
export const MAX_CATEGORIES_PER_MENU = 100;
export const MAX_VARIANTS_PER_PRODUCT = 20;
export const MAX_OPTION_GROUPS_PER_PRODUCT = 10;
export const MAX_OPTIONS_PER_GROUP = 30;
/** Productos que caben en una petición de orden (el plan `pro` permite 1000). */
export const MAX_REORDER_ITEMS = 1000;

/** Precio en centavos, de $0.00 a $100,000.00. */
export const MAX_PRICE_CENTS = 10_000_000;
export const PriceCents = z.int().min(0).max(MAX_PRICE_CENTS);

const CatalogName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\p{Cc}]+$/u);

/** Descripción opcional del producto; admite saltos de línea. Vacía = sin descripción. */
const Description = z
  .string()
  .trim()
  .max(500)
  .regex(/^(?:[^\p{Cc}]|[\n\r])*$/u);

const Version = z.int().positive();

export const CategoryParams = z.strictObject({ categoryId: z.uuidv7() });
export const ProductParams = z.strictObject({ productId: z.uuidv7() });

export const DUPLICATE_IDS = "La lista tiene elementos repetidos.";
export const MIN_ABOVE_MAX = "El mínimo no puede ser mayor que el máximo.";
export const MAX_ABOVE_OPTIONS = "El máximo no puede ser mayor que el número de opciones.";

// Entradas ----------------------------------------------------------------------------------

export const CreateCategoryInput = z.strictObject({ name: CatalogName });
export type CreateCategoryInput = z.infer<typeof CreateCategoryInput>;

/** La posición solo cambia con `PUT /categories/order`. */
export const UpdateCategoryInput = z.strictObject({ version: Version, name: CatalogName });
export type UpdateCategoryInput = z.infer<typeof UpdateCategoryInput>;

/**
 * Orden nuevo: la lista completa de ids no borrados, en el orden deseado. Si falta o sobra alguno
 * (otra persona agregó o borró algo) → `CONFLICT`.
 */
export const ReorderInput = z.strictObject({
  ids: z
    .array(z.uuidv7())
    .min(1)
    .max(MAX_REORDER_ITEMS)
    .refine((ids) => new Set(ids).size === ids.length, { message: DUPLICATE_IDS }),
});
export type ReorderInput = z.infer<typeof ReorderInput>;

/** Variante del producto (tamaño, presentación). Si hay variantes, su precio reemplaza al del producto. */
export const VariantInput = z.strictObject({ name: CatalogName, priceCents: PriceCents });
export type VariantInput = z.infer<typeof VariantInput>;

/** Opción de un grupo; `priceDeltaCents` se suma al precio (nunca resta). */
export const OptionInput = z.strictObject({ name: CatalogName, priceDeltaCents: PriceCents });
export type OptionInput = z.infer<typeof OptionInput>;

/**
 * Grupo de opciones (salsas, extras). El comensal elige de `minSelect` a `maxSelect` opciones:
 * `0 ≤ minSelect ≤ maxSelect ≤ opciones`.
 */
export const OptionGroupInput = z
  .strictObject({
    name: CatalogName,
    minSelect: z.int().min(0).max(MAX_OPTIONS_PER_GROUP),
    maxSelect: z.int().min(1).max(MAX_OPTIONS_PER_GROUP),
    options: z.array(OptionInput).min(1).max(MAX_OPTIONS_PER_GROUP),
  })
  .refine((group) => group.minSelect <= group.maxSelect, {
    message: MIN_ABOVE_MAX,
    path: ["minSelect"],
  })
  .refine((group) => group.maxSelect <= group.options.length, {
    message: MAX_ABOVE_OPTIONS,
    path: ["maxSelect"],
  });
export type OptionGroupInput = z.infer<typeof OptionGroupInput>;

const Variants = z.array(VariantInput).max(MAX_VARIANTS_PER_PRODUCT);
const OptionGroups = z.array(OptionGroupInput).max(MAX_OPTION_GROUPS_PER_PRODUCT);

/** Producto nuevo al final de su categoría. Variantes y grupos van en el orden de la lista. */
export const CreateProductInput = z.strictObject({
  categoryId: z.uuidv7(),
  name: CatalogName,
  description: Description.nullable().optional(),
  priceCents: PriceCents,
  available: z.boolean().optional(),
  variants: Variants.optional(),
  optionGroups: OptionGroups.optional(),
});
export type CreateProductInput = z.infer<typeof CreateProductInput>;

/**
 * Cambios parciales con `version` obligatorio. `variants` y `optionGroups`, si se envían,
 * reemplazan la lista completa (sus ids cambian); si se omiten, no cambian. Cambiar `categoryId`
 * mueve el producto al final de esa categoría. `imageAssetId` liga una imagen subida con
 * `POST /media` (T17); `null` la quita.
 */
export const UpdateProductInput = z.strictObject({
  version: Version,
  categoryId: z.uuidv7().optional(),
  name: CatalogName.optional(),
  description: Description.nullable().optional(),
  priceCents: PriceCents.optional(),
  available: z.boolean().optional(),
  variants: Variants.optional(),
  optionGroups: OptionGroups.optional(),
  imageAssetId: z.uuidv7().nullable().optional(),
});
export type UpdateProductInput = z.infer<typeof UpdateProductInput>;

export const ProductAvailabilityInput = z.strictObject({
  version: Version,
  available: z.boolean(),
});
export type ProductAvailabilityInput = z.infer<typeof ProductAvailabilityInput>;

// Respuestas --------------------------------------------------------------------------------

export const VariantDto = z
  .strictObject({ id: z.uuidv7(), name: z.string(), priceCents: z.int(), position: z.int() })
  .meta({ id: "VariantDto" });
export type VariantDto = z.infer<typeof VariantDto>;

export const OptionDto = z
  .strictObject({ id: z.uuidv7(), name: z.string(), priceDeltaCents: z.int(), position: z.int() })
  .meta({ id: "OptionDto" });
export type OptionDto = z.infer<typeof OptionDto>;

export const OptionGroupDto = z
  .strictObject({
    id: z.uuidv7(),
    name: z.string(),
    minSelect: z.int(),
    maxSelect: z.int(),
    position: z.int(),
    options: z.array(OptionDto),
  })
  .meta({ id: "OptionGroupDto" });
export type OptionGroupDto = z.infer<typeof OptionGroupDto>;

export const ProductDto = z
  .strictObject({
    id: z.uuidv7(),
    categoryId: z.uuidv7(),
    name: z.string(),
    description: z.string().nullable(),
    priceCents: z.int(),
    available: z.boolean(),
    position: z.int(),
    version: Version,
    variants: z.array(VariantDto),
    optionGroups: z.array(OptionGroupDto),
    /** URL pública de la imagen (T17); `null` sin imagen. El frontend no arma rutas de R2. */
    imageUrl: z.url().nullable(),
    imageWidth: z.int().positive().nullable(),
    imageHeight: z.int().positive().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "ProductDto" });
export type ProductDto = z.infer<typeof ProductDto>;

export const CategoryDto = z
  .strictObject({
    id: z.uuidv7(),
    name: z.string(),
    position: z.int(),
    version: Version,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "CategoryDto" });
export type CategoryDto = z.infer<typeof CategoryDto>;

export const MenuCategoryDto = CategoryDto.extend({ products: z.array(ProductDto) }).meta({
  id: "MenuCategoryDto",
});
export type MenuCategoryDto = z.infer<typeof MenuCategoryDto>;

/**
 * Menú completo para el panel: incluye productos no disponibles; nunca los borrados. `slug` y la
 * publicación se completan en T18. `menuVersion` sube con cada cambio del catálogo (ADR-014).
 */
export const MenuDto = z
  .strictObject({
    id: z.uuidv7(),
    branchId: z.uuidv7(),
    status: MenuStatus,
    slug: z.string().nullable(),
    publishedAt: z.iso.datetime().nullable(),
    menuVersion: Version,
    categories: z.array(MenuCategoryDto),
  })
  .meta({ id: "MenuDto" });
export type MenuDto = z.infer<typeof MenuDto>;

/** Resultado de un cambio de orden: la posición y la `version` nuevas de cada elemento. */
export const ReorderResultDto = z
  .strictObject({
    items: z.array(z.strictObject({ id: z.uuidv7(), position: z.int(), version: Version })),
  })
  .meta({ id: "ReorderResultDto" });
export type ReorderResultDto = z.infer<typeof ReorderResultDto>;
