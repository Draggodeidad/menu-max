import { z } from "zod";
import { E164Phone, MAX_TABLE_COUNT, PostalCode } from "./businesses";
import { MAX_OPTION_GROUPS_PER_PRODUCT, MAX_OPTIONS_PER_GROUP } from "./catalog";
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from "./storefront";

// Pedidos (T21, ADR-010, ADR-011, ADR-013). El comensal pide como invitado; la API calcula
// precios y totales con el catálogo de D1. Las transiciones del panel son de T23.

/**
 * Estados del pedido. T21 solo crea `pending`; la lista completa está desde ahora para que el
 * `CHECK` de `orders.status` no obligue a reconstruir la tabla en T23, que define las
 * transiciones.
 */
export const ORDER_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "preparing",
  "ready",
  "out_for_delivery",
  "completed",
  "delivered",
  "cancelled",
] as const;
export const OrderStatus = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatus>;

/** Mesa, recoger en sucursal o domicilio. Mismos nombres que `BranchModes`. */
export const ORDER_MODES = ["table", "pickup", "delivery"] as const;
export const OrderMode = z.enum(ORDER_MODES);
export type OrderMode = z.infer<typeof OrderMode>;

/** Pagos en línea están fuera del MVP: se paga al recibir. */
export const PAYMENT_METHODS = ["cash"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Eventos del outbox de avisos (ADR-011). `order.status_changed` lo emite T23. */
export const OUTBOX_EVENTS = ["order.created", "order.status_changed"] as const;
export type OutboxEvent = (typeof OUTBOX_EVENTS)[number];
export const OUTBOX_STATUSES = ["pending", "published"] as const;

/** Moneda de todos los importes del MVP. */
export const ORDER_CURRENCIES = ["MXN"] as const;

/** Topes de ADR-010: 50 líneas por pedido y 99 unidades por línea. */
export const MAX_ORDER_ITEMS = 50;
export const MAX_ITEM_QUANTITY = 99;
export const MAX_CUSTOMER_NAME_LENGTH = 80;
export const MAX_ORDER_NOTES_LENGTH = 500;
export const MAX_ITEM_NOTES_LENGTH = 200;
export const MAX_ADDRESS_FIELD_LENGTH = 120;
export const MAX_ADDRESS_REFERENCES_LENGTH = 200;

export const TABLE_NUMBER_REQUIRED = "Indica el número de tu mesa.";
export const TABLE_NUMBER_NOT_ALLOWED = "El número de mesa solo aplica a pedidos en mesa.";
export const DELIVERY_REQUIRED = "Escribe la dirección de entrega.";
export const DELIVERY_NOT_ALLOWED = "La dirección solo aplica a pedidos a domicilio.";
export const QUANTITY_RANGE = `La cantidad debe ser de 1 a ${MAX_ITEM_QUANTITY}.`;

/** Texto de una línea: sin caracteres de control. */
function text(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}]+$/u);
}

/** Notas: admiten saltos de línea, pero ningún otro carácter de control. */
function notes(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}]*(?:[\n\r]+[^\p{Cc}]*)*$/u);
}

export const OrderItemInput = z.strictObject({
  productId: z.uuidv7(),
  variantId: z.uuidv7().optional(),
  optionIds: z.array(z.uuidv7()).max(MAX_OPTION_GROUPS_PER_PRODUCT * MAX_OPTIONS_PER_GROUP),
  quantity: z
    .int({ message: QUANTITY_RANGE })
    .min(1, { message: QUANTITY_RANGE })
    .max(MAX_ITEM_QUANTITY, { message: QUANTITY_RANGE }),
  notes: notes(MAX_ITEM_NOTES_LENGTH).optional(),
});
export type OrderItemInput = z.infer<typeof OrderItemInput>;

export const OrderCustomerInput = z.strictObject({
  name: text(MAX_CUSTOMER_NAME_LENGTH),
  phone: E164Phone,
  /** El comensal acepta recibir avisos de su pedido por WhatsApp. */
  whatsappOptIn: z.boolean(),
});
export type OrderCustomerInput = z.infer<typeof OrderCustomerInput>;

export const OrderDeliveryInput = z.strictObject({
  street: text(MAX_ADDRESS_FIELD_LENGTH),
  number: text(MAX_ADDRESS_FIELD_LENGTH),
  neighborhood: text(MAX_ADDRESS_FIELD_LENGTH),
  city: text(MAX_ADDRESS_FIELD_LENGTH),
  postalCode: PostalCode,
  references: notes(MAX_ADDRESS_REFERENCES_LENGTH).optional(),
});
export type OrderDeliveryInput = z.infer<typeof OrderDeliveryInput>;

/**
 * Pedido público. Sin precios, totales, estado ni ids de organización o sucursal: el menú se
 * identifica por su slug y la API calcula todo (objeto estricto: una llave de más → 400).
 * `tableNumber` solo con `mode: "table"` y `delivery` solo con `mode: "delivery"`; el rango
 * real de la mesa (`1…tableCount`) y la zona por código postal los valida el servicio.
 */
export const OrderInput = z
  .strictObject({
    menuSlug: z.string().min(1).max(SLUG_MAX_LENGTH).regex(SLUG_PATTERN),
    mode: OrderMode,
    tableNumber: z.int().min(1).max(MAX_TABLE_COUNT).optional(),
    items: z.array(OrderItemInput).min(1).max(MAX_ORDER_ITEMS),
    customer: OrderCustomerInput,
    delivery: OrderDeliveryInput.optional(),
    notes: notes(MAX_ORDER_NOTES_LENGTH).optional(),
  })
  .superRefine((order, ctx) => {
    if (order.mode === "table" && order.tableNumber === undefined) {
      ctx.addIssue({ code: "custom", path: ["tableNumber"], message: TABLE_NUMBER_REQUIRED });
    }
    if (order.mode !== "table" && order.tableNumber !== undefined) {
      ctx.addIssue({ code: "custom", path: ["tableNumber"], message: TABLE_NUMBER_NOT_ALLOWED });
    }
    if (order.mode === "delivery" && order.delivery === undefined) {
      ctx.addIssue({ code: "custom", path: ["delivery"], message: DELIVERY_REQUIRED });
    }
    if (order.mode !== "delivery" && order.delivery !== undefined) {
      ctx.addIssue({ code: "custom", path: ["delivery"], message: DELIVERY_NOT_ALLOWED });
    }
  });
export type OrderInput = z.infer<typeof OrderInput>;

/**
 * Pedido registrado. `trackingToken` abre el seguimiento (`/pedido/{token}`, T22); la base solo
 * guarda su SHA-256. Un reintento con la misma `Idempotency-Key` y el mismo cuerpo devuelve
 * exactamente esta respuesta, con el mismo token.
 */
export const OrderCreatedDto = z
  .strictObject({
    number: z.int().positive(),
    status: OrderStatus,
    totalCents: z.int().nonnegative(),
    trackingToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .meta({ id: "OrderCreatedDto" });
export type OrderCreatedDto = z.infer<typeof OrderCreatedDto>;
