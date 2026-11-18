// Cálculo del pedido (T21): función pura, sin I/O. Recibe el catálogo vigente leído de D1 (nunca
// de caché, ADR-014) y los ítems del comensal; devuelve las líneas con su copia del catálogo y
// los importes en centavos, o los errores por ítem para `fieldErrors`.
import { MAX_ITEM_QUANTITY, QUANTITY_RANGE, type OrderItemInput } from "@menu-max/contracts";
import type { OrderOptionSnapshot } from "@menu-max/database";

export type CatalogOption = { id: string; name: string; priceDeltaCents: number };
export type CatalogOptionGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: CatalogOption[];
};
export type CatalogVariant = { id: string; name: string; priceCents: number };

/** Producto disponible, no borrado, en una categoría no borrada del menú del pedido. */
export type CatalogProduct = {
  id: string;
  name: string;
  priceCents: number;
  variants: CatalogVariant[];
  optionGroups: CatalogOptionGroup[];
};

export type PricedLine = {
  productId: string;
  productName: string;
  variantName: string | null;
  optionsSnapshot: OrderOptionSnapshot[];
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  notes: string | null;
};

export type PricingResult =
  | { ok: true; lines: PricedLine[]; subtotalCents: number }
  | { ok: false; fieldErrors: Record<string, string[]> };

export const PRODUCT_UNAVAILABLE = "Este producto ya no está disponible. Quítalo para continuar.";
export const VARIANT_REQUIRED = "Elige una de las presentaciones de este producto.";
export const VARIANT_UNAVAILABLE =
  "Esa presentación ya no está disponible. Elige otra para continuar.";
export const OPTION_UNAVAILABLE =
  "Una de las opciones elegidas ya no está disponible. Revisa tu selección.";
export const DUPLICATE_OPTION = "Elegiste la misma opción más de una vez. Revisa tu selección.";

export function minSelectMessage(group: CatalogOptionGroup): string {
  return group.minSelect === 1
    ? `Elige al menos una opción en «${group.name}».`
    : `Elige al menos ${group.minSelect} opciones en «${group.name}».`;
}

export function maxSelectMessage(group: CatalogOptionGroup): string {
  return group.maxSelect === 1
    ? `Elige solo una opción en «${group.name}».`
    : `Elige como máximo ${group.maxSelect} opciones en «${group.name}».`;
}

type LineResult = { line: PricedLine } | { field: string; message: string };

function priceLine(item: OrderItemInput, product: CatalogProduct | undefined): LineResult {
  if (!product) return { field: "productId", message: PRODUCT_UNAVAILABLE };
  if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_ITEM_QUANTITY) {
    return { field: "quantity", message: QUANTITY_RANGE };
  }

  // Con variantes, el precio de la variante reemplaza al del producto y elegir una es obligatorio.
  let basePriceCents = product.priceCents;
  let variantName: string | null = null;
  if (product.variants.length > 0) {
    if (item.variantId === undefined) return { field: "variantId", message: VARIANT_REQUIRED };
    const variant = product.variants.find((candidate) => candidate.id === item.variantId);
    if (!variant) return { field: "variantId", message: VARIANT_UNAVAILABLE };
    basePriceCents = variant.priceCents;
    variantName = variant.name;
  } else if (item.variantId !== undefined) {
    return { field: "variantId", message: VARIANT_UNAVAILABLE };
  }

  if (new Set(item.optionIds).size !== item.optionIds.length) {
    return { field: "optionIds", message: DUPLICATE_OPTION };
  }
  const chosen = new Set(item.optionIds);
  const snapshot: OrderOptionSnapshot[] = [];
  for (const group of product.optionGroups) {
    for (const option of group.options) {
      if (!chosen.has(option.id)) continue;
      chosen.delete(option.id);
      snapshot.push({
        groupId: group.id,
        groupName: group.name,
        optionId: option.id,
        name: option.name,
        priceDeltaCents: option.priceDeltaCents,
      });
    }
  }
  // Lo que queda no es de ningún grupo de este producto: de otro producto o ya no existe.
  if (chosen.size > 0) return { field: "optionIds", message: OPTION_UNAVAILABLE };
  for (const group of product.optionGroups) {
    const count = snapshot.filter((option) => option.groupId === group.id).length;
    if (count < group.minSelect) return { field: "optionIds", message: minSelectMessage(group) };
    if (count > group.maxSelect) return { field: "optionIds", message: maxSelectMessage(group) };
  }

  const unitPriceCents =
    basePriceCents + snapshot.reduce((sum, option) => sum + option.priceDeltaCents, 0);
  return {
    line: {
      productId: product.id,
      productName: product.name,
      variantName,
      optionsSnapshot: snapshot,
      unitPriceCents,
      quantity: item.quantity,
      lineTotalCents: unitPriceCents * item.quantity,
      notes: item.notes ?? null,
    },
  };
}

/**
 * Valida cada ítem contra el catálogo y calcula sus importes: producto existente y disponible,
 * variante y opciones del mismo producto, `min_select`/`max_select` por grupo y de 1 a 99
 * unidades. Los errores van por ítem (`items.2.productId`), uno por ítem, para que el comensal
 * sepa qué línea corregir.
 */
export function priceOrder(
  catalog: ReadonlyMap<string, CatalogProduct>,
  items: readonly OrderItemInput[],
): PricingResult {
  const lines: PricedLine[] = [];
  const fieldErrors: Record<string, string[]> = {};
  items.forEach((item, index) => {
    const result = priceLine(item, catalog.get(item.productId));
    if ("line" in result) lines.push(result.line);
    else fieldErrors[`items.${index}.${result.field}`] = [result.message];
  });
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return {
    ok: true,
    lines,
    subtotalCents: lines.reduce((sum, line) => sum + line.lineTotalCents, 0),
  };
}
