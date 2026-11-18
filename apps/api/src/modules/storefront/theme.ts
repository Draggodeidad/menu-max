// Tema y slug del menú público (T18): funciones puras, sin I/O.
import {
  DEFAULT_THEME,
  MIN_CONTRAST_RATIO,
  RESERVED_SLUGS,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  THEME_PRESET_COLORS,
  type FontPreset,
  type PlanFeatures,
  type ProductLayout,
  type ThemePreset,
} from "@menu-max/contracts";

// Contraste WCAG 2.x ------------------------------------------------------------------------

function channel(value: number) {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** Luminancia relativa de un color `#RRGGBB`. */
export function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = channel((value >> 16) & 0xff);
  const g = channel((value >> 8) & 0xff);
  const b = channel(value & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razón de contraste entre dos colores, de 1 a 21. */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Qué hacer con `color` para que contraste con `background`: oscurecerlo o aclararlo. */
function direction(background: string) {
  return contrastRatio("#000000", background) >= contrastRatio("#FFFFFF", background)
    ? "más oscuro"
    : "más claro";
}

function ratioText(ratio: number) {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}

export type ThemeColors = { primaryColor: string; backgroundColor: string; textColor: string };

/**
 * `fieldErrors` del tema si el color principal o el del texto no alcanzan contraste AA (4.5:1)
 * sobre el fondo; `undefined` si cumple. Cada mensaje dice qué color cambiar y hacia dónde.
 */
export function contrastErrors(colors: ThemeColors): Record<string, string[]> | undefined {
  const errors: Record<string, string[]> = {};
  const checks = [
    ["primaryColor", "El color principal", colors.primaryColor],
    ["textColor", "El color del texto", colors.textColor],
  ] as const;
  for (const [field, label, color] of checks) {
    const ratio = contrastRatio(color, colors.backgroundColor);
    if (ratio < MIN_CONTRAST_RATIO) {
      errors[field] = [
        `${label} casi no se distingue del fondo (contraste ${ratioText(ratio)}; se necesita ${MIN_CONTRAST_RATIO}:1). Usa un color ${direction(colors.backgroundColor)} o cambia el fondo.`,
      ];
    }
  }
  return Object.keys(errors).length > 0 ? errors : undefined;
}

// Tema efectivo -----------------------------------------------------------------------------

/** Tema tal como está guardado; `null` en un color = el del preset. */
export type StoredTheme = {
  preset: ThemePreset;
  primaryColor: string | null;
  backgroundColor: string | null;
  textColor: string | null;
  fontPreset: FontPreset;
  productLayout: ProductLayout;
  logoAssetId: string | null;
  coverAssetId: string | null;
  showBranding: boolean;
};

export const DEFAULT_STORED_THEME: StoredTheme = {
  ...DEFAULT_THEME,
  primaryColor: null,
  backgroundColor: null,
  textColor: null,
  logoAssetId: null,
  coverAssetId: null,
  showBranding: true,
};

export type EffectiveTheme = ThemeColors & {
  preset: ThemePreset;
  fontPreset: FontPreset;
  productLayout: ProductLayout;
  logoAssetId: string | null;
  coverAssetId: string | null;
  showBranding: boolean;
};

/**
 * Lo que ve el comensal según el plan vigente. Sin `customTheme`: preset y color principal, con
 * fondo, texto, fuente y acomodo del preset y sin imágenes; sin `removeBranding`: sello visible.
 * Lo guardado no cambia: al volver a `pro` reaparece. Si el color principal no contrasta con el
 * fondo efectivo (p. ej., tras bajar de plan con un fondo propio), se usa el del preset.
 */
export function effectiveTheme(stored: StoredTheme, features: PlanFeatures): EffectiveTheme {
  const base = THEME_PRESET_COLORS[stored.preset];
  const custom = features.customTheme;
  const backgroundColor = (custom ? stored.backgroundColor : null) ?? base.backgroundColor;
  const textColor = (custom ? stored.textColor : null) ?? base.textColor;
  const primary = stored.primaryColor ?? base.primaryColor;
  const primaryColor =
    contrastRatio(primary, backgroundColor) >= MIN_CONTRAST_RATIO ? primary : base.primaryColor;
  return {
    preset: stored.preset,
    primaryColor,
    backgroundColor,
    textColor,
    fontPreset: custom ? stored.fontPreset : DEFAULT_THEME.fontPreset,
    productLayout: custom ? stored.productLayout : DEFAULT_THEME.productLayout,
    logoAssetId: custom ? stored.logoAssetId : null,
    coverAssetId: custom ? stored.coverAssetId : null,
    showBranding: features.removeBranding ? stored.showBranding : true,
  };
}

/** Campos que exigen `customTheme` y tienen un valor distinto al del tema sin personalizar. */
export function customizedFields(changes: Partial<StoredTheme>): string[] {
  const fields: string[] = [];
  for (const field of ["backgroundColor", "textColor", "logoAssetId", "coverAssetId"] as const) {
    if (changes[field] !== undefined && changes[field] !== null) fields.push(field);
  }
  if (changes.fontPreset !== undefined && changes.fontPreset !== DEFAULT_THEME.fontPreset) {
    fields.push("fontPreset");
  }
  if (
    changes.productLayout !== undefined &&
    changes.productLayout !== DEFAULT_THEME.productLayout
  ) {
    fields.push("productLayout");
  }
  return fields;
}

// Slug --------------------------------------------------------------------------------------

/** Espacio para el sufijo `-NNN` dentro del largo máximo. */
const SLUG_BASE_MAX = SLUG_MAX_LENGTH - 4;
const FALLBACK_SLUG = "menu";

export function isReservedSlug(slug: string) {
  return (RESERVED_SLUGS as readonly string[]).includes(slug);
}

/**
 * Base del slug a partir del nombre del negocio: minúsculas, sin acentos, guiones en lugar de
 * espacios y símbolos ("Tacos El Güero" → `tacos-el-guero`). Un nombre sin letras ni números da
 * `menu`; uno de menos de 3 caracteres se completa con `-menu`.
 */
export function slugBase(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_BASE_MAX)
    .replace(/-+$/g, "");
  if (base === "") return FALLBACK_SLUG;
  return base.length < SLUG_MIN_LENGTH ? `${base}-${FALLBACK_SLUG}` : base;
}

/**
 * Primer slug libre: la base si no está tomada ni reservada; si no, `base-2`, `base-3`… `taken`
 * son los slugs existentes que empiezan por la base.
 */
export function firstFreeSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base) && !isReservedSlug(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
