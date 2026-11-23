import {
  ORDER_CURRENCIES,
  ORDER_MODES,
  ORDER_STATUSES,
  OUTBOX_EVENTS,
  OUTBOX_STATUSES,
  PAYMENT_METHODS,
} from "@menu-max/contracts";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { branches, deliveryZones } from "./business";
import { menus, products } from "./catalog";
import { id, inList, organizationId, timestamps, version } from "./columns";
import { organizationMembers, organizations } from "./tenancy";

// Pedidos (T21, ADR-011, ADR-013, ADR-016). Los pedidos nunca se borran. Los datos del comensal
// solo viven en `orders` (ADR-015); `order_items` guarda la copia de lo vendido, así que editar
// o borrar el catálogo no cambia un pedido ya hecho.

/** Copia de una opción elegida, tal como estaba en el catálogo al pedir. */
export type OrderOptionSnapshot = {
  groupId: string;
  groupName: string;
  optionId: string;
  name: string;
  priceDeltaCents: number;
};

/** Contenido de `notification_outbox.payload_json`: solo ids; el aviso se arma al enviarlo. */
export type OutboxPayload = { orderId: string };

/**
 * Pedido. `number` es el número visible por sucursal (`#1042`, ADR-013): sale de
 * `branches.next_order_number` dentro del mismo `db.batch` y nunca sirve para consultar. El
 * seguimiento público se busca por `tracking_token_hash`.
 */
export const orders = sqliteTable(
  "orders",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id, {
      onDelete: "restrict",
    }),
    branchId: text("branch_id").notNull(),
    menuId: text("menu_id").notNull(),
    number: integer("number").notNull(),
    status: text("status", { enum: ORDER_STATUSES }).notNull().default("pending"),
    mode: text("mode", { enum: ORDER_MODES }).notNull(),
    tableNumber: integer("table_number"),
    customerName: text("customer_name").notNull(),
    /** E.164. Dato personal: solo lo ven los miembros (T23). */
    customerPhone: text("customer_phone").notNull(),
    /** SHA-256 hex de `PHONE_HASH_SALT` + teléfono: cuotas sin leer el teléfono en claro. */
    customerPhoneHash: text("customer_phone_hash").notNull(),
    customerWhatsappOptIn: integer("customer_whatsapp_opt_in", { mode: "boolean" })
      .notNull()
      .default(false),
    deliveryStreet: text("delivery_street"),
    deliveryNumber: text("delivery_number"),
    deliveryNeighborhood: text("delivery_neighborhood"),
    deliveryCity: text("delivery_city"),
    deliveryPostalCode: text("delivery_postal_code"),
    deliveryReferences: text("delivery_references"),
    /** Zona que atendió el código postal (ADR-018); su tarifa queda copiada en el pedido. */
    deliveryZoneId: text("delivery_zone_id"),
    subtotalCents: integer("subtotal_cents").notNull(),
    deliveryFeeCents: integer("delivery_fee_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency", { enum: ORDER_CURRENCIES }).notNull().default("MXN"),
    paymentMethod: text("payment_method", { enum: PAYMENT_METHODS }).notNull().default("cash"),
    notes: text("notes"),
    /** Pedido de prueba de un miembro de la organización (`/app/listo`). */
    isTest: integer("is_test", { mode: "boolean" }).notNull().default(false),
    trackingTokenHash: text("tracking_token_hash").notNull(),
    version: version(),
    ...timestamps(),
  },
  (table) => [
    // Destino de las FKs compuestas de `order_items` y `order_status_history`.
    uniqueIndex("orders_org_id_unique").on(table.organizationId, table.id),
    // El contador de la sucursal nunca repite un número.
    uniqueIndex("orders_org_branch_number_unique").on(
      table.organizationId,
      table.branchId,
      table.number,
    ),
    uniqueIndex("orders_tracking_token_hash_unique").on(table.trackingTokenHash),
    // Panel (T23): pedidos de una sucursal por estado y cambios recientes.
    index("orders_org_branch_status_updated_idx").on(
      table.organizationId,
      table.branchId,
      table.status,
      table.updatedAt,
    ),
    // Cuota de pedidos por teléfono y sucursal (ADR-010).
    index("orders_branch_phone_created_idx").on(
      table.branchId,
      table.customerPhoneHash,
      table.createdAt,
    ),
    foreignKey({
      name: "orders_branch_fk",
      columns: [table.organizationId, table.branchId],
      foreignColumns: [branches.organizationId, branches.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "orders_menu_fk",
      columns: [table.organizationId, table.menuId],
      foreignColumns: [menus.organizationId, menus.id],
    }).onDelete("restrict"),
    // Con `delivery_zone_id` nulo, SQLite no aplica la FK.
    foreignKey({
      name: "orders_delivery_zone_fk",
      columns: [table.organizationId, table.deliveryZoneId],
      foreignColumns: [deliveryZones.organizationId, deliveryZones.id],
    }).onDelete("restrict"),
    check("orders_status_check", inList(table.status, ORDER_STATUSES)),
    check("orders_mode_check", inList(table.mode, ORDER_MODES)),
    check("orders_payment_method_check", inList(table.paymentMethod, PAYMENT_METHODS)),
    check("orders_currency_check", inList(table.currency, ORDER_CURRENCIES)),
    check("orders_number_check", sql`${table.number} >= 1`),
    check(
      "orders_table_number_check",
      sql`(${table.mode} = 'table' and ${table.tableNumber} >= 1) or (${table.mode} <> 'table' and ${table.tableNumber} is null)`,
    ),
    check(
      "orders_delivery_check",
      sql`(${table.mode} = 'delivery' and ${table.deliveryStreet} is not null and ${table.deliveryNumber} is not null and ${table.deliveryNeighborhood} is not null and ${table.deliveryCity} is not null and ${table.deliveryPostalCode} is not null and ${table.deliveryZoneId} is not null) or (${table.mode} <> 'delivery' and ${table.deliveryStreet} is null and ${table.deliveryNumber} is null and ${table.deliveryNeighborhood} is null and ${table.deliveryCity} is null and ${table.deliveryPostalCode} is null and ${table.deliveryReferences} is null and ${table.deliveryZoneId} is null and ${table.deliveryFeeCents} = 0)`,
    ),
    check(
      "orders_amounts_check",
      sql`${table.subtotalCents} >= 0 and ${table.deliveryFeeCents} >= 0 and ${table.totalCents} = ${table.subtotalCents} + ${table.deliveryFeeCents}`,
    ),
  ],
);

/** Líneas del pedido con la copia de nombre, variante, opciones y precio al pedir. */
export const orderItems = sqliteTable(
  "order_items",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id, {
      onDelete: "restrict",
    }),
    orderId: text("order_id").notNull(),
    productId: text("product_id").notNull(),
    productName: text("product_name").notNull(),
    variantName: text("variant_name"),
    optionsSnapshot: text("options_snapshot", { mode: "json" })
      .$type<OrderOptionSnapshot[]>()
      .notNull()
      .default([]),
    /** Precio de la variante (o del producto) más los recargos de las opciones. */
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull(),
    lineTotalCents: integer("line_total_cents").notNull(),
    notes: text("notes"),
  },
  (table) => [
    index("order_items_org_order_idx").on(table.organizationId, table.orderId),
    foreignKey({
      name: "order_items_order_fk",
      columns: [table.organizationId, table.orderId],
      foreignColumns: [orders.organizationId, orders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "order_items_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [products.organizationId, products.id],
    }).onDelete("restrict"),
    check(
      "order_items_options_snapshot_check",
      sql`json_valid(${table.optionsSnapshot}) and json_type(${table.optionsSnapshot}) = 'array'`,
    ),
    check("order_items_quantity_check", sql`${table.quantity} between 1 and 99`),
    check(
      "order_items_amounts_check",
      sql`${table.unitPriceCents} >= 0 and ${table.lineTotalCents} = ${table.unitPriceCents} * ${table.quantity}`,
    ),
  ],
);

/**
 * Bitácora de estados. La creación se registra como `null → pending`, sin miembro que actúe;
 * las transiciones del panel (T23) llevan `actor_member_id`.
 */
export const orderStatusHistory = sqliteTable(
  "order_status_history",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id, {
      onDelete: "restrict",
    }),
    orderId: text("order_id").notNull(),
    fromStatus: text("from_status", { enum: ORDER_STATUSES }),
    toStatus: text("to_status", { enum: ORDER_STATUSES }).notNull(),
    actorMemberId: text("actor_member_id"),
    reason: text("reason"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("order_status_history_org_order_idx").on(table.organizationId, table.orderId),
    foreignKey({
      name: "order_status_history_order_fk",
      columns: [table.organizationId, table.orderId],
      foreignColumns: [orders.organizationId, orders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "order_status_history_actor_fk",
      columns: [table.organizationId, table.actorMemberId],
      foreignColumns: [organizationMembers.organizationId, organizationMembers.id],
    }).onDelete("restrict"),
    check(
      "order_status_history_from_check",
      sql`${table.fromStatus} is null or ${inList(table.fromStatus, ORDER_STATUSES)}`,
    ),
    check("order_status_history_to_check", inList(table.toStatus, ORDER_STATUSES)),
  ],
);

/**
 * Outbox transaccional de avisos de pedidos (ADR-011): se inserta en el mismo `db.batch` que el
 * pedido. El relay (T24) publica las filas `pending` en la cola y las marca `published`.
 */
export const notificationOutbox = sqliteTable(
  "notification_outbox",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id, {
      onDelete: "restrict",
    }),
    event: text("event", { enum: OUTBOX_EVENTS }).notNull(),
    payloadJson: text("payload_json", { mode: "json" }).$type<OutboxPayload>().notNull(),
    status: text("status", { enum: OUTBOX_STATUSES }).notNull().default("pending"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    check("notification_outbox_event_check", inList(table.event, OUTBOX_EVENTS)),
    check("notification_outbox_status_check", inList(table.status, OUTBOX_STATUSES)),
    check("notification_outbox_payload_check", sql`json_valid(${table.payloadJson})`),
  ],
);
