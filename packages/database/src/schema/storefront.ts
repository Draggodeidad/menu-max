import { FONT_PRESETS, PRODUCT_LAYOUTS, THEME_PRESETS } from "@menu-max/contracts";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { id, inList, organizationId, version } from "./columns";
import { menus } from "./catalog";
import { mediaAssets } from "./media";
import { organizations } from "./tenancy";

// Storefront (T18, ADR-016). Tema del menú público: uno por menú. Se guarda tal cual lo eligió el
// negocio, aunque su plan ya no lo permita: la lectura pública calcula el tema efectivo.

const HEX_COLOR = "[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]";

/** `CHECK` de un color `#RRGGBB` en mayúsculas, o `null` (= el color del preset). */
function hexColorCheck(column: unknown) {
  return sql`${column} is null or ${column} glob ${`#${HEX_COLOR}`}`.inlineParams();
}

export const storefrontThemes = sqliteTable(
  "storefront_themes",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id, {
      onDelete: "restrict",
    }),
    menuId: text("menu_id").notNull(),
    preset: text("preset", { enum: THEME_PRESETS }).notNull().default("minimal"),
    /** Colores `#RRGGBB`; `null` = el del preset. */
    primaryColor: text("primary_color"),
    backgroundColor: text("background_color"),
    textColor: text("text_color"),
    fontPreset: text("font_preset", { enum: FONT_PRESETS }).notNull().default("sans"),
    productLayout: text("product_layout", { enum: PRODUCT_LAYOUTS }).notNull().default("list"),
    /**
     * Imágenes del tema (T17). FK simple, como `products.image_asset_id`: el servicio comprueba
     * que el asset sea de la misma organización.
     */
    logoAssetId: text("logo_asset_id").references(() => mediaAssets.id, { onDelete: "restrict" }),
    coverAssetId: text("cover_asset_id").references(() => mediaAssets.id, {
      onDelete: "restrict",
    }),
    /** Sello "Hecho con MenusMax"; ponerlo en `false` exige la capacidad `removeBranding`. */
    showBranding: integer("show_branding", { mode: "boolean" }).notNull().default(true),
    version: version(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("storefront_themes_menu_id_unique").on(table.menuId),
    uniqueIndex("storefront_themes_org_menu_unique").on(table.organizationId, table.menuId),
    foreignKey({
      name: "storefront_themes_menu_fk",
      columns: [table.organizationId, table.menuId],
      foreignColumns: [menus.organizationId, menus.id],
    }).onDelete("restrict"),
    check("storefront_themes_preset_check", inList(table.preset, THEME_PRESETS)),
    check("storefront_themes_font_check", inList(table.fontPreset, FONT_PRESETS)),
    check("storefront_themes_layout_check", inList(table.productLayout, PRODUCT_LAYOUTS)),
    check("storefront_themes_primary_check", hexColorCheck(table.primaryColor)),
    check("storefront_themes_background_check", hexColorCheck(table.backgroundColor)),
    check("storefront_themes_text_check", hexColorCheck(table.textColor)),
  ],
);
