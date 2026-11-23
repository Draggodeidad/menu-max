import { z } from "zod";
import { E164Phone, MAX_TABLE_COUNT, PostalCode } from "./businesses";
import { MAX_OPTION_GROUPS_PER_PRODUCT, MAX_OPTIONS_PER_GROUP } from "./catalog";
import { CursorQuery } from "./organizations";
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from "./storefront";

// Pedidos (T21, T22, T23; ADR-007, ADR-010, ADR-011, ADR-013). El comensal pide como invitado; la
// API calcula precios y totales con el catálogo de D1 y el panel opera la máquina de estados.

/** Estados del pedido. T21 crea `pending`; las transiciones están en `ORDER_TRANSITIONS`. */
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

/** Estados sin transición posible: al llegar a uno, WEB detiene el polling del seguimiento. */
export const FINAL_STATUSES = [
  "completed",
  "delivered",
  "rejected",
  "cancelled",
] as const satisfies readonly OrderStatus[];

/** Estados que el panel muestra como pedidos en curso. */
export const ACTIVE_STATUSES = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "out_for_delivery",
] as const satisfies readonly OrderStatus[];

/** Mesa, recoger en sucursal o domicilio. Mismos nombres que `BranchModes`. */
export const ORDER_MODES = ["table", "pickup", "delivery"] as const;
export const OrderMode = z.enum(ORDER_MODES);
export type OrderMode = z.infer<typeof OrderMode>;

type OrderTransitionMap = Readonly<Record<OrderStatus, readonly OrderStatus[]>>;

const ON_SITE_TRANSITIONS: OrderTransitionMap = {
  pending: ["accepted", "rejected"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  out_for_delivery: [],
  completed: [],
  delivered: [],
  rejected: [],
  cancelled: [],
};

const DELIVERY_TRANSITIONS: OrderTransitionMap = {
  ...ON_SITE_TRANSITIONS,
  ready: ["out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered", "cancelled"],
};

/**
 * Máquina de estados por modalidad (T23). `ready` y `out_for_delivery` admiten `cancelled` para
 * cerrar un pedido que nadie recogió o una entrega fallida.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderMode, OrderTransitionMap>> = {
  table: ON_SITE_TRANSITIONS,
  pickup: ON_SITE_TRANSITIONS,
  delivery: DELIVERY_TRANSITIONS,
};

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

/**
 * Seguimiento público del pedido (T22). Quien tiene el enlace ve solo esto: sin nombre ni teléfono
 * del comensal, notas, opciones ni dirección (de un domicilio, solo la colonia).
 */
export const PublicOrderDto = z
  .strictObject({
    number: z.int().positive(),
    status: OrderStatus,
    /** `true` si `status` está en `FINAL_STATUSES`: WEB deja de consultar. */
    isFinal: z.boolean(),
    mode: OrderMode,
    tableNumber: z.int().positive().nullable(),
    deliveryNeighborhood: z.string().nullable(),
    items: z.array(
      z.strictObject({
        name: z.string(),
        variantName: z.string().nullable(),
        quantity: z.int().positive(),
      }),
    ),
    totalCents: z.int().nonnegative(),
    createdAt: z.iso.datetime(),
    history: z.array(z.strictObject({ status: OrderStatus, at: z.iso.datetime() })),
    businessName: z.string(),
    branchName: z.string(),
    /** Teléfono público de la sucursal, si lo capturó. */
    contactPhone: z.string().nullable(),
  })
  .meta({ id: "PublicOrderDto" });
export type PublicOrderDto = z.infer<typeof PublicOrderDto>;

// Panel de pedidos (T23, ADR-007). Solo para miembros de la organización.

export const MAX_ORDER_REASON_LENGTH = 280;
export const REASON_REQUIRED = "Escribe el motivo para rechazar o cancelar el pedido.";
export const REASON_NOT_ALLOWED = "El motivo solo aplica al rechazar o cancelar un pedido.";

/** Mayor fecha que representa `Date`: un `since` más grande no se puede convertir. */
const MAX_DATE_MS = 8_640_000_000_000_000;

export const OrderParams = z.strictObject({ orderId: z.uuidv7() });

/**
 * Listado del panel. `status` elige la pestaña (`active` o `done`). Con `since` (ms), `status` se
 * ignora y vuelven todos los pedidos cambiados desde entonces, también los que ya terminaron, para
 * que el panel los quite del tablero.
 */
export const OrderListQuery = CursorQuery.extend({
  status: z.enum(["active", "done"]).default("active"),
  since: z.coerce.number().int().min(0).max(MAX_DATE_MS).optional(),
});
export type OrderListQuery = z.infer<typeof OrderListQuery>;

/** Cambio de estado. `reason` es obligatorio al rechazar o cancelar y no aplica en otro caso. */
export const OrderTransitionInput = z
  .strictObject({
    to: OrderStatus,
    version: z.int().positive(),
    reason: text(MAX_ORDER_REASON_LENGTH).optional(),
  })
  .superRefine((input, ctx) => {
    const needsReason = input.to === "rejected" || input.to === "cancelled";
    if (needsReason && input.reason === undefined) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: REASON_REQUIRED });
    }
    if (!needsReason && input.reason !== undefined) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: REASON_NOT_ALLOWED });
    }
  });
export type OrderTransitionInput = z.infer<typeof OrderTransitionInput>;

const PanelOrderItemDto = z.strictObject({
  name: z.string(),
  variantName: z.string().nullable(),
  options: z.array(z.strictObject({ name: z.string(), priceDeltaCents: z.int() })),
  quantity: z.int().positive(),
  unitPriceCents: z.int().nonnegative(),
  lineTotalCents: z.int().nonnegative(),
  notes: z.string().nullable(),
});

const panelOrderFields = {
  id: z.uuidv7(),
  number: z.int().positive(),
  status: OrderStatus,
  isFinal: z.boolean(),
  mode: OrderMode,
  tableNumber: z.int().positive().nullable(),
  customerName: z.string(),
  totalCents: z.int().nonnegative(),
  notes: z.string().nullable(),
  isTest: z.boolean(),
  /** Se envía de vuelta en la transición (concurrencia optimista). */
  version: z.int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  items: z.array(PanelOrderItemDto),
};

/** Pedido en el listado: sin teléfono ni dirección, que solo van en el detalle. */
export const OrderSummaryDto = z.strictObject(panelOrderFields).meta({ id: "OrderSummaryDto" });
export type OrderSummaryDto = z.infer<typeof OrderSummaryDto>;

export const OrderListDto = z
  .strictObject({
    items: z.array(OrderSummaryDto),
    nextCursor: z.uuidv7().nullable(),
    /**
     * Valor de `since` para el siguiente sondeo. Con varias páginas, usa el de la primera: incluye
     * un margen, así que un pedido puede repetirse; identifícalo por `id` y `version`.
     */
    nextSince: z.int().nonnegative(),
  })
  .meta({ id: "OrderListDto" });
export type OrderListDto = z.infer<typeof OrderListDto>;

/** Detalle para quien opera la sucursal: incluye teléfono, dirección e historial con actor. */
export const OrderDetailDto = z
  .strictObject({
    ...panelOrderFields,
    customerPhone: z.string(),
    customerWhatsappOptIn: z.boolean(),
    delivery: z
      .strictObject({
        street: z.string(),
        number: z.string(),
        neighborhood: z.string(),
        city: z.string(),
        postalCode: z.string(),
        references: z.string().nullable(),
      })
      .nullable(),
    subtotalCents: z.int().nonnegative(),
    deliveryFeeCents: z.int().nonnegative(),
    currency: z.enum(ORDER_CURRENCIES),
    paymentMethod: z.enum(PAYMENT_METHODS),
    history: z.array(
      z.strictObject({
        from: OrderStatus.nullable(),
        to: OrderStatus,
        /** `null` en la creación: el pedido lo hizo el comensal. */
        actorMemberId: z.uuidv7().nullable(),
        reason: z.string().nullable(),
        at: z.iso.datetime(),
      }),
    ),
  })
  .meta({ id: "OrderDetailDto" });
export type OrderDetailDto = z.infer<typeof OrderDetailDto>;
