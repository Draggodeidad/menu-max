import {
  branches,
  businesses,
  notificationOutbox,
  orderItems,
  orders,
  orderStatusHistory,
  type OrderOptionSnapshot,
} from "@menu-max/database";
import type { OrderMode } from "@menu-max/contracts";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../infrastructure/db";

// Pedidos (T21, T22). Arma las sentencias y lecturas; las reglas viven en el servicio.

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
