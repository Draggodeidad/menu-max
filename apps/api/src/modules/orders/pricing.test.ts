import type { OrderItemInput } from "@menu-max/contracts";
import { describe, expect, it } from "vitest";
import {
  DUPLICATE_OPTION,
  OPTION_UNAVAILABLE,
  PRODUCT_UNAVAILABLE,
  VARIANT_REQUIRED,
  VARIANT_UNAVAILABLE,
  priceOrder,
  type CatalogProduct,
} from "./pricing";

const ids = {
  taco: "0190f5c2-7a10-7000-8000-000000000001",
  agua: "0190f5c2-7a10-7000-8000-000000000002",
  chica: "0190f5c2-7a10-7000-8000-000000000011",
  grande: "0190f5c2-7a10-7000-8000-000000000012",
  salsas: "0190f5c2-7a10-7000-8000-000000000021",
  extras: "0190f5c2-7a10-7000-8000-000000000022",
  verde: "0190f5c2-7a10-7000-8000-000000000031",
  roja: "0190f5c2-7a10-7000-8000-000000000032",
  queso: "0190f5c2-7a10-7000-8000-000000000033",
  cebolla: "0190f5c2-7a10-7000-8000-000000000034",
  hielo: "0190f5c2-7a10-7000-8000-000000000035",
  ajeno: "0190f5c2-7a10-7000-8000-000000000099",
};

const taco: CatalogProduct = {
  id: ids.taco,
  name: "Taco al pastor",
  priceCents: 2500,
  variants: [],
  optionGroups: [
    {
      id: ids.salsas,
      name: "Salsa",
      minSelect: 1,
      maxSelect: 1,
      options: [
        { id: ids.verde, name: "Verde", priceDeltaCents: 0 },
        { id: ids.roja, name: "Roja", priceDeltaCents: 0 },
      ],
    },
    {
      id: ids.extras,
      name: "Extras",
      minSelect: 0,
      maxSelect: 2,
      options: [
        { id: ids.queso, name: "Queso", priceDeltaCents: 1000 },
        { id: ids.cebolla, name: "Cebolla asada", priceDeltaCents: 500 },
        { id: ids.hielo, name: "Doble tortilla", priceDeltaCents: 300 },
      ],
    },
  ],
};

const agua: CatalogProduct = {
  id: ids.agua,
  name: "Agua de horchata",
  priceCents: 3000,
  variants: [
    { id: ids.chica, name: "Chica", priceCents: 2500 },
    { id: ids.grande, name: "Grande", priceCents: 4000 },
  ],
  optionGroups: [],
};

const catalog = new Map([
  [taco.id, taco],
  [agua.id, agua],
]);

function item(overrides: Partial<OrderItemInput> = {}): OrderItemInput {
  return { productId: ids.taco, optionIds: [ids.verde], quantity: 1, ...overrides };
}

describe("priceOrder", () => {
  it("suma variante u opción base, recargos y cantidades; copia nombres y opciones", () => {
    const result = priceOrder(catalog, [
      item({ optionIds: [ids.roja, ids.queso, ids.cebolla], quantity: 3, notes: "Sin piña" }),
      item({ productId: ids.agua, variantId: ids.grande, optionIds: [], quantity: 2 }),
    ]);
    expect(result).toEqual({
      ok: true,
      subtotalCents: (2500 + 1000 + 500) * 3 + 4000 * 2,
      lines: [
        {
          productId: ids.taco,
          productName: "Taco al pastor",
          variantName: null,
          optionsSnapshot: [
            {
              groupId: ids.salsas,
              groupName: "Salsa",
              optionId: ids.roja,
              name: "Roja",
              priceDeltaCents: 0,
            },
            {
              groupId: ids.extras,
              groupName: "Extras",
              optionId: ids.queso,
              name: "Queso",
              priceDeltaCents: 1000,
            },
            {
              groupId: ids.extras,
              groupName: "Extras",
              optionId: ids.cebolla,
              name: "Cebolla asada",
              priceDeltaCents: 500,
            },
          ],
          unitPriceCents: 4000,
          quantity: 3,
          lineTotalCents: 12_000,
          notes: "Sin piña",
        },
        {
          productId: ids.agua,
          productName: "Agua de horchata",
          variantName: "Grande",
          optionsSnapshot: [],
          unitPriceCents: 4000,
          quantity: 2,
          lineTotalCents: 8000,
          notes: null,
        },
      ],
    });
  });

  it("marca cada ítem con su propio error, en la llave de su posición", () => {
    const result = priceOrder(catalog, [
      item(),
      item({ productId: ids.ajeno }),
      item({ productId: ids.agua, optionIds: [] }),
      item({ productId: ids.agua, variantId: ids.ajeno, optionIds: [] }),
      item({ variantId: ids.chica }),
      item({ optionIds: [ids.verde, ids.verde] }),
      item({ optionIds: [ids.verde, ids.ajeno] }),
    ]);
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        "items.1.productId": [PRODUCT_UNAVAILABLE],
        "items.2.variantId": [VARIANT_REQUIRED],
        "items.3.variantId": [VARIANT_UNAVAILABLE],
        "items.4.variantId": [VARIANT_UNAVAILABLE],
        "items.5.optionIds": [DUPLICATE_OPTION],
        "items.6.optionIds": [OPTION_UNAVAILABLE],
      },
    });
  });

  it("rechaza la variante de otro producto", () => {
    const result = priceOrder(catalog, [
      item({ productId: ids.agua, variantId: ids.salsas, optionIds: [] }),
    ]);
    expect(result).toEqual({
      ok: false,
      fieldErrors: { "items.0.variantId": [VARIANT_UNAVAILABLE] },
    });
  });

  it("rechaza la opción de un grupo de otro producto", () => {
    const result = priceOrder(catalog, [
      item({ productId: ids.agua, variantId: ids.chica, optionIds: [ids.queso] }),
    ]);
    expect(result).toEqual({
      ok: false,
      fieldErrors: { "items.0.optionIds": [OPTION_UNAVAILABLE] },
    });
  });

  it.each([
    { optionIds: [], message: "Elige al menos una opción en «Salsa»." },
    { optionIds: [ids.verde, ids.roja], message: "Elige solo una opción en «Salsa»." },
    {
      optionIds: [ids.verde, ids.queso, ids.cebolla, ids.hielo],
      message: "Elige como máximo 2 opciones en «Extras».",
    },
  ])("aplica min_select y max_select por grupo ($message)", ({ optionIds, message }) => {
    expect(priceOrder(catalog, [item({ optionIds })])).toEqual({
      ok: false,
      fieldErrors: { "items.0.optionIds": [message] },
    });
  });

  it.each([0, 100, 1.5])("rechaza %d unidades", (quantity) => {
    expect(priceOrder(catalog, [item({ quantity })])).toEqual({
      ok: false,
      fieldErrors: { "items.0.quantity": ["La cantidad debe ser de 1 a 99."] },
    });
  });

  it("acepta de 1 a 99 unidades", () => {
    const result = priceOrder(catalog, [item({ quantity: 1 }), item({ quantity: 99 })]);
    expect(result.ok && result.subtotalCents).toBe(2500 * 100);
  });
});
