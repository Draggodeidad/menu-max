import {
  branches,
  businesses,
  notificationOutbox,
  orderItems,
  orders,
  orderStatusHistory,
  organizationMembers,
  users,
  type OrderOptionSnapshot,
  type OutboxPayload,
} from "@menu-max/database";
import {
  ACTIVE_STATUSES,
  FINAL_STATUSES,
  ORDER_STATUSES,
  type OrderMode,
  type OrderStatus,
} from "@menu-max/contracts";
import { and, asc, desc, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "../../infrastructure/db";
import type { TenantContext } from "../../types";

// Pedidos (T21, T22, T23). Arma las sentencias y lecturas; las reglas viven en el servicio.

export type NewOrderLine = {
  id: string;
  productId: string;
  productName: string;
  variantName: string | null;
  optionsSnapshot: OrderOptionSnapshot[];
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  notes: string | null;
};

export type NewOrder = {
  id: string;
  orgId: string;
  branchId: string;
  menuId: string;
  mode: OrderMode;
  tableNumber: number | null;
  customer: { name: string; phone: string; phoneHash: string; whatsappOptIn: boolean };
  delivery: {
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    postalCode: string;
    references: string | null;
    zoneId: string;
  } | null;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  notes: string | null;
  isTest: boolean;
  trackingTokenHash: string;
  lines: NewOrderLine[];
  historyId: string;
  /** `null` = sin aviso (pedido de prueba de una cuenta sin verificar). */
  outboxId: string | null;
  now: Date;
};

/** Sucursal del pedido, siempre con su organización. */
function sameBranch(order: Pick<NewOrder, "orgId" | "branchId">) {
  return and(eq(branches.organizationId, order.orgId), eq(branches.id, order.branchId));
}

/**
 * Sentencias del pedido, en orden: el pedido toma `branches.next_order_number` con una
 * subconsulta y la siguiente sentencia lo incrementa. D1 ejecuta el batch como una transacción
 * serializada, así que dos pedidos simultáneos nunca leen el mismo número (y el índice único
 * `(organization_id, branch_id, number)` lo garantiza de todos modos). Si cualquier sentencia
 * falla, no se escribe nada.
 */
export function createOrderStatements(db: Db, order: NewOrder) {
  const statements = [
    db
      .insert(orders)
      .values({
        id: order.id,
        organizationId: order.orgId,
        branchId: order.branchId,
        menuId: order.menuId,
        number: sql<number>`(select ${branches.nextOrderNumber} from ${branches} where ${sameBranch(order)})`,
        status: "pending",
        mode: order.mode,
        tableNumber: order.tableNumber,
        customerName: order.customer.name,
        customerPhone: order.customer.phone,
        customerPhoneHash: order.customer.phoneHash,
        customerWhatsappOptIn: order.customer.whatsappOptIn,
        deliveryStreet: order.delivery?.street ?? null,
        deliveryNumber: order.delivery?.number ?? null,
        deliveryNeighborhood: order.delivery?.neighborhood ?? null,
        deliveryCity: order.delivery?.city ?? null,
        deliveryPostalCode: order.delivery?.postalCode ?? null,
        deliveryReferences: order.delivery?.references ?? null,
        deliveryZoneId: order.delivery?.zoneId ?? null,
        subtotalCents: order.subtotalCents,
        deliveryFeeCents: order.deliveryFeeCents,
        totalCents: order.totalCents,
        currency: "MXN",
        paymentMethod: "cash",
        notes: order.notes,
        isTest: order.isTest,
        trackingTokenHash: order.trackingTokenHash,
        createdAt: order.now,
        updatedAt: order.now,
      })
      .returning({ number: orders.number }),
    // El contador no es una edición de la sucursal: no cambia `version` ni `updated_at`.
    db
      .update(branches)
      .set({
        nextOrderNumber: sql`${branches.nextOrderNumber} + 1`,
        updatedAt: sql`${branches.updatedAt}`,
      })
      .where(sameBranch(order)),
    db.insert(orderItems).values(
      order.lines.map((line) => ({
        id: line.id,
        organizationId: order.orgId,
        orderId: order.id,
        productId: line.productId,
        productName: line.productName,
        variantName: line.variantName,
        optionsSnapshot: line.optionsSnapshot,
        unitPriceCents: line.unitPriceCents,
        quantity: line.quantity,
        lineTotalCents: line.lineTotalCents,
        notes: line.notes,
      })),
    ),
    db.insert(orderStatusHistory).values({
      id: order.historyId,
      organizationId: order.orgId,
      orderId: order.id,
      fromStatus: null,
      toStatus: "pending",
      actorMemberId: null,
      createdAt: order.now,
    }),
  ] as const;
  if (order.outboxId === null) return statements;
  return [
    ...statements,
    db.insert(notificationOutbox).values({
      id: order.outboxId,
      organizationId: order.orgId,
      event: "order.created",
      payloadJson: { orderId: order.id },
      status: "pending",
      createdAt: order.now,
    }),
  ] as const;
}

/**
 * Respuesta que se guarda en `idempotency_keys` (sin el token de seguimiento: el servicio lo
 * vuelve a derivar del `orderId`). El número se lee del pedido insertado antes en el mismo batch.
 */
export function storedOrderResponse(order: Pick<NewOrder, "id" | "orgId" | "totalCents">) {
  return sql`json_object('orderId', ${order.id}, 'number', (select ${orders.number} from ${orders} where ${and(
    eq(orders.organizationId, order.orgId),
    eq(orders.id, order.id),
  )}), 'status', 'pending', 'totalCents', ${order.totalCents})`;
}

/**
 * Pedido por el hash de su token (T22), solo con las columnas publicables. No filtra sucursales
 * borradas ni organizaciones suspendidas: el comensal conserva el seguimiento de lo que ya pidió.
 */
export async function findTrackedOrder(db: Db, trackingTokenHash: string) {
  const [order] = await db
    .select({
      id: orders.id,
      organizationId: orders.organizationId,
      number: orders.number,
      status: orders.status,
      mode: orders.mode,
      tableNumber: orders.tableNumber,
      deliveryNeighborhood: orders.deliveryNeighborhood,
      totalCents: orders.totalCents,
      version: orders.version,
      createdAt: orders.createdAt,
      businessName: businesses.name,
      branchName: branches.name,
      contactPhone: branches.contactPhone,
    })
    .from(orders)
    .innerJoin(
      branches,
      and(eq(branches.organizationId, orders.organizationId), eq(branches.id, orders.branchId)),
    )
    .innerJoin(
      businesses,
      and(
        eq(businesses.organizationId, branches.organizationId),
        eq(businesses.id, branches.businessId),
      ),
    )
    .where(eq(orders.trackingTokenHash, trackingTokenHash))
    .limit(1);
  return order ?? null;
}

/** Líneas e historial del pedido, en el orden en que se registraron (`rowid`). */
export async function loadTrackedOrderDetails(
  db: Db,
  order: { id: string; organizationId: string },
) {
  const [items, history] = await db.batch([
    db
      .select({
        name: orderItems.productName,
        variantName: orderItems.variantName,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .where(
        and(eq(orderItems.organizationId, order.organizationId), eq(orderItems.orderId, order.id)),
      )
      .orderBy(sql`rowid`),
    db
      .select({ status: orderStatusHistory.toStatus, at: orderStatusHistory.createdAt })
      .from(orderStatusHistory)
      .where(
        and(
          eq(orderStatusHistory.organizationId, order.organizationId),
          eq(orderStatusHistory.orderId, order.id),
        ),
      )
      .orderBy(orderStatusHistory.createdAt, sql`rowid`),
  ]);
  return { items, history };
}

// Panel (T23) --------------------------------------------------------------------------------

const summaryColumns = {
  id: orders.id,
  number: orders.number,
  status: orders.status,
  mode: orders.mode,
  tableNumber: orders.tableNumber,
  customerName: orders.customerName,
  totalCents: orders.totalCents,
  notes: orders.notes,
  isTest: orders.isTest,
  version: orders.version,
  createdAt: orders.createdAt,
  updatedAt: orders.updatedAt,
};

const itemColumns = {
  orderId: orderItems.orderId,
  name: orderItems.productName,
  variantName: orderItems.variantName,
  options: orderItems.optionsSnapshot,
  quantity: orderItems.quantity,
  unitPriceCents: orderItems.unitPriceCents,
  lineTotalCents: orderItems.lineTotalCents,
  notes: orderItems.notes,
};

function branchOrders(tenant: TenantContext, branchId: string) {
  return and(eq(orders.organizationId, tenant.orgId), eq(orders.branchId, branchId));
}

/** Huella de los pedidos en curso: cualquier cambio en el tablero la modifica. */
function activeStampQuery(db: Db, tenant: TenantContext, branchId: string) {
  return db
    .select({
      lastUpdate: sql<number | null>`max(${orders.updatedAt})`,
      total: sql<number>`count(*)`,
      versions: sql<number>`coalesce(sum(${orders.version}), 0)`,
    })
    .from(orders)
    .where(and(branchOrders(tenant, branchId), inArray(orders.status, ACTIVE_STATUSES)));
}

export type ActiveStamp = { lastUpdate: number | null; total: number; versions: number };

export async function readActiveStamp(
  db: Db,
  tenant: TenantContext,
  branchId: string,
): Promise<ActiveStamp> {
  const [stamp] = await activeStampQuery(db, tenant, branchId);
  return stamp ?? { lastUpdate: null, total: 0, versions: 0 };
}

export type OrderPageFilter = {
  status: "active" | "done";
  since: number | undefined;
  cursor: string | undefined;
  limit: number;
};

/**
 * Con `since` se listan todos los estados: incluirlos en el `IN` deja usar el índice
 * `(organization_id, branch_id, status, updated_at)` también para el rango de `updated_at`.
 */
function pageWhere(
  tenant: TenantContext,
  branchId: string,
  page: OrderPageFilter,
  newest: boolean,
) {
  const scope =
    page.since !== undefined
      ? and(inArray(orders.status, ORDER_STATUSES), gte(orders.updatedAt, new Date(page.since)))
      : inArray(orders.status, page.status === "active" ? ACTIVE_STATUSES : FINAL_STATUSES);
  const after = page.cursor
    ? newest
      ? lt(orders.id, page.cursor)
      : gt(orders.id, page.cursor)
    : undefined;
  return and(branchOrders(tenant, branchId), scope, after);
}

/**
 * Una página del panel en un solo `batch`: huella del tablero, pedidos y sus líneas. Trae un
 * pedido de más para saber si hay otra página. Los terminados van del más nuevo al más antiguo;
 * lo demás, en orden de llegada.
 */
export async function loadOrderPage(
  db: Db,
  tenant: TenantContext,
  branchId: string,
  page: OrderPageFilter,
) {
  const newest = page.since === undefined && page.status === "done";
  const where = pageWhere(tenant, branchId, page, newest);
  const order = newest ? desc(orders.id) : asc(orders.id);
  const [stamps, rows, items] = await db.batch([
    activeStampQuery(db, tenant, branchId),
    db
      .select(summaryColumns)
      .from(orders)
      .where(where)
      .orderBy(order)
      .limit(page.limit + 1),
    db
      .select(itemColumns)
      .from(orderItems)
      .where(
        and(
          eq(orderItems.organizationId, tenant.orgId),
          inArray(
            orderItems.orderId,
            db
              .select({ id: orders.id })
              .from(orders)
              .where(where)
              .orderBy(order)
              .limit(page.limit + 1),
          ),
        ),
      )
      .orderBy(sql`rowid`),
  ]);
  return { stamp: stamps[0] ?? { lastUpdate: null, total: 0, versions: 0 }, rows, items };
}

/** Pedido completo de la sucursal, con líneas e historial, en un solo `batch`. */
export async function findPanelOrder(
  db: Db,
  tenant: TenantContext,
  branchId: string,
  orderId: string,
) {
  const [found, items, history] = await db.batch([
    db
      .select({
        ...summaryColumns,
        customerPhone: orders.customerPhone,
        customerWhatsappOptIn: orders.customerWhatsappOptIn,
        deliveryStreet: orders.deliveryStreet,
        deliveryNumber: orders.deliveryNumber,
        deliveryNeighborhood: orders.deliveryNeighborhood,
        deliveryCity: orders.deliveryCity,
        deliveryPostalCode: orders.deliveryPostalCode,
        deliveryReferences: orders.deliveryReferences,
        subtotalCents: orders.subtotalCents,
        deliveryFeeCents: orders.deliveryFeeCents,
        currency: orders.currency,
        paymentMethod: orders.paymentMethod,
      })
      .from(orders)
      .where(and(branchOrders(tenant, branchId), eq(orders.id, orderId)))
      .limit(1),
    db
      .select(itemColumns)
      .from(orderItems)
      .where(and(eq(orderItems.organizationId, tenant.orgId), eq(orderItems.orderId, orderId)))
      .orderBy(sql`rowid`),
    db
      .select({
        from: orderStatusHistory.fromStatus,
        to: orderStatusHistory.toStatus,
        actorMemberId: orderStatusHistory.actorMemberId,
        reason: orderStatusHistory.reason,
        at: orderStatusHistory.createdAt,
      })
      .from(orderStatusHistory)
      .where(
        and(
          eq(orderStatusHistory.organizationId, tenant.orgId),
          eq(orderStatusHistory.orderId, orderId),
        ),
      )
      .orderBy(orderStatusHistory.createdAt, sql`rowid`),
  ]);
  const [order] = found;
  return order ? { order, items, history } : null;
}

/** Lo que decide una transición, con `hasVerifiedOwner` para el aviso (ADR-008). */
export async function findOrderForTransition(
  db: Db,
  tenant: TenantContext,
  branchId: string,
  orderId: string,
) {
  const [order] = await db
    .select({
      status: orders.status,
      mode: orders.mode,
      version: orders.version,
      isTest: orders.isTest,
      customerWhatsappOptIn: orders.customerWhatsappOptIn,
      hasVerifiedOwner: sql<number>`exists (select 1 from ${organizationMembers} inner join ${users} on ${eq(
        users.id,
        organizationMembers.userId,
      )} where ${and(
        eq(organizationMembers.organizationId, orders.organizationId),
        eq(organizationMembers.role, "owner"),
        eq(organizationMembers.status, "active"),
        eq(users.emailVerified, true),
      )})`,
    })
    .from(orders)
    .where(and(branchOrders(tenant, branchId), eq(orders.id, orderId)))
    .limit(1);
  return order ?? null;
}

export type OrderTransition = {
  orgId: string;
  branchId: string;
  orderId: string;
  from: OrderStatus;
  to: OrderStatus;
  version: number;
  actorMemberId: string;
  reason: string | null;
  historyId: string;
  /** `null` = sin aviso al comensal. */
  outboxId: string | null;
  now: Date;
};

/**
 * Aplica la transición en un solo `batch`. Historial y outbox se insertan antes del `update` y
 * con la misma condición (`version` y estado leídos): si otra persona ya cambió el pedido, las
 * tres sentencias no afectan ninguna fila. Devuelve `false` en ese caso.
 */
export async function applyOrderTransition(db: Db, change: OrderTransition): Promise<boolean> {
  const unchanged = and(
    eq(orders.organizationId, change.orgId),
    eq(orders.branchId, change.branchId),
    eq(orders.id, change.orderId),
    eq(orders.version, change.version),
    eq(orders.status, change.from),
  );
  const at = change.now.getTime();
  const history = db.insert(orderStatusHistory).select(
    db
      .select({
        id: sql<string>`${change.historyId}`.as("id"),
        organizationId: orders.organizationId,
        orderId: sql<string>`${orders.id}`.as("order_id"),
        fromStatus: sql<OrderStatus>`${change.from}`.as("from_status"),
        toStatus: sql<OrderStatus>`${change.to}`.as("to_status"),
        actorMemberId: sql<string>`${change.actorMemberId}`.as("actor_member_id"),
        reason: sql<string | null>`${change.reason}`.as("reason"),
        createdAt: sql<Date>`${at}`.as("created_at"),
      })
      .from(orders)
      .where(unchanged),
  );
  const update = db
    .update(orders)
    .set({ status: change.to, version: sql`${orders.version} + 1`, updatedAt: change.now })
    .where(unchanged)
    .returning({ id: orders.id });

  if (change.outboxId === null) {
    const [, updated] = await db.batch([history, update]);
    return updated.length === 1;
  }
  const payload: OutboxPayload = { orderId: change.orderId, toStatus: change.to };
  const outbox = db.insert(notificationOutbox).select(
    db
      .select({
        id: sql<string>`${change.outboxId}`.as("id"),
        organizationId: orders.organizationId,
        event: sql<"order.status_changed">`'order.status_changed'`.as("event"),
        payloadJson: sql<OutboxPayload>`${JSON.stringify(payload)}`.as("payload_json"),
        status: sql<"pending">`'pending'`.as("status"),
        createdAt: sql<Date>`${at}`.as("created_at"),
        publishedAt: sql<Date | null>`null`.as("published_at"),
      })
      .from(orders)
      .where(unchanged),
  );
  const [, , updated] = await db.batch([history, outbox, update]);
  return updated.length === 1;
}
