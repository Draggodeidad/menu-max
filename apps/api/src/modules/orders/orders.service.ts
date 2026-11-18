import {
  OrderStatus,
  type NotAcceptingReason,
  type OrderCreatedDto,
  type OrderInput,
  type OrderMode,
} from "@menu-max/contracts";
import { z } from "zod";
import type { Env } from "../../env";
import type { Db } from "../../infrastructure/db";
import { verifyTurnstile } from "../../infrastructure/turnstile";
import { canAccessBranch } from "../../shared/authz/policies";
import { AppError } from "../../shared/errors";
import { findStoredResponse, requestHash, storeResponseStatements } from "../../shared/idempotency";
import { hashToken, newId, orderTrackingToken } from "../../shared/ids";
import { log } from "../../shared/log";
import { hit } from "../../shared/rate-counters";
import type { AuthUser } from "../auth/auth";
import { loadTenant } from "../organizations/organizations.service";
import { loadCheckout, type CheckoutContext } from "../storefront/storefront.service";
import { createOrderStatements, storedOrderResponse, type NewOrder } from "./orders.repository";
import { priceOrder } from "./pricing";

// Pedido público (T21, ADR-010, ADR-011, ADR-013): el comensal pide como invitado y la API lo
// registra una sola vez, con el total que ella calcula y su aviso en el outbox.

export const PUBLIC_ORDER_SCOPE = "public-order";

const HOUR_MS = 60 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
// Cuotas exactas de ADR-010, con ventana fija en UTC.
const ORDERS_PER_IP_PER_HOUR = 30;
const ORDERS_PER_PHONE_PER_10_MIN = 3;

export const IP_QUOTA_MESSAGE =
  "Recibimos demasiados pedidos desde esta conexión. Inténtalo de nuevo más tarde.";
export const PHONE_QUOTA_MESSAGE =
  "Ya enviaste varios pedidos en pocos minutos. Espera un momento antes de enviar otro.";
export const NO_DELIVERY_ZONE = "No entregamos en ese código postal.";
export const TABLE_OUT_OF_RANGE =
  "Esa mesa no existe en esta sucursal. Revisa el número de tu mesa.";
export const ITEMS_CHANGED =
  "Algunos productos de tu pedido cambiaron. Revisa los productos marcados.";

const NOT_ACCEPTING_MESSAGES = {
  unpublished: "Este menú no existe o no está publicado.",
  suspended:
    "Este negocio no está recibiendo pedidos en línea por ahora. Comunícate con la sucursal.",
  inactive: "Este menú aún no está activo. Comunícate con el negocio para hacer tu pedido.",
  unverified:
    "Este negocio todavía no recibe pedidos en línea. Comunícate con la sucursal para hacer tu pedido.",
  closed:
    "La sucursal está cerrada en este momento. Revisa su horario y haz tu pedido cuando abra.",
} satisfies Record<NotAcceptingReason, string>;

const MODE_OFF_MESSAGES = {
  table: "Esta sucursal no recibe pedidos en mesa. Elige otra forma de recibir tu pedido.",
  pickup: "Esta sucursal no recibe pedidos para recoger. Elige otra forma de recibir tu pedido.",
  delivery: "Esta sucursal no entrega a domicilio. Elige otra forma de recibir tu pedido.",
} satisfies Record<OrderMode, string>;

/**
 * El pedido de prueba de un miembro (`/app/listo`) se acepta aunque ningún dueño haya verificado
 * su correo o la sucursal esté cerrada: el alta no captura horarios. Lo demás sigue bloqueando.
 */
const TEST_ORDER_ALLOWED_REASONS: ReadonlySet<NotAcceptingReason> = new Set([
  "unverified",
  "closed",
]);

export type OrderDeps = {
  db: Db;
  env: Pick<Env, "TURNSTILE_SECRET_KEY" | "PHONE_HASH_SALT" | "ORDER_TOKEN_SECRET">;
  requestId: string;
  clientIp: string | undefined;
  user: AuthUser | null;
  turnstileToken: string | null | undefined;
};

export type OrderResult = { statusCode: 201; body: OrderCreatedDto; replayed: boolean };

/** Respuesta guardada en `idempotency_keys`: sin el token, que se deriva del `orderId`. */
const StoredOrder = z.object({
  orderId: z.string().min(1),
  number: z.int().positive(),
  status: OrderStatus,
  totalCents: z.int().nonnegative(),
});

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 hex de `PHONE_HASH_SALT` + teléfono E.164 (T21, ADR-015). */
export function phoneHash(salt: string, phone: string): Promise<string> {
  return sha256Hex(`${salt}${phone}`);
}

function formatMxn(cents: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);
}

async function consume(
  deps: OrderDeps,
  quota: "ip" | "phone",
  key: string,
  windowMs: number,
  limit: number,
  message: string,
) {
  const result = await hit(deps.db, key, windowMs, limit);
  if (result.allowed) return;
  log.warn("order.quota_exceeded", { requestId: deps.requestId, quota });
  throw new AppError("RATE_LIMITED", message, undefined, result.retryAfterMs / 1000);
}

async function replay(deps: OrderDeps, stored: { body: unknown }): Promise<OrderResult> {
  const parsed = StoredOrder.safeParse(stored.body);
  if (!parsed.success) {
    log.error("order.stored_response_invalid", { requestId: deps.requestId });
    throw new AppError("INTERNAL");
  }
  const { orderId, ...rest } = parsed.data;
  log.info("order.replayed", { requestId: deps.requestId });
  return {
    statusCode: 201,
    body: {
      ...rest,
      trackingToken: await orderTrackingToken(deps.env.ORDER_TOKEN_SECRET, orderId),
    },
    replayed: true,
  };
}

/**
 * ¿Pedido de prueba? Lo decide el servidor, nunca el cuerpo: hay sesión, es miembro activo de la
 * organización del menú y, si es `staff`, de esa sucursal.
 */
async function isTestOrder(deps: OrderDeps, checkout: CheckoutContext): Promise<boolean> {
  if (!deps.user) return false;
  const tenant = await loadTenant(deps.db, checkout.orgId, deps.user.id, deps.requestId);
  return tenant !== null && canAccessBranch(tenant, checkout.branchId).allowed;
}

function assertAccepting(checkout: CheckoutContext, isTest: boolean) {
  const { reason } = checkout.acceptance;
  if (reason === null) return;
  if (isTest && TEST_ORDER_ALLOWED_REASONS.has(reason)) return;
  if (reason === "unpublished") throw new AppError("NOT_FOUND", NOT_ACCEPTING_MESSAGES[reason]);
  throw new AppError("BUSINESS_RULE", NOT_ACCEPTING_MESSAGES[reason]);
}

/** Modalidad activa, mesa en `1…tableCount` y zona por código postal (ADR-018). */
function assertModeRules(checkout: CheckoutContext, input: OrderInput) {
  if (!checkout.modes[input.mode]) {
    const message = MODE_OFF_MESSAGES[input.mode];
    throw new AppError("BUSINESS_RULE", message, { mode: [message] });
  }
  if (input.mode === "table") {
    const table = input.tableNumber ?? 0;
    if (table < 1 || table > checkout.tableCount) {
      throw new AppError("BUSINESS_RULE", TABLE_OUT_OF_RANGE, {
        tableNumber: [TABLE_OUT_OF_RANGE],
      });
    }
  }
  if (input.mode === "delivery" && !checkout.zone) {
    throw new AppError("BUSINESS_RULE", NO_DELIVERY_ZONE, {
      "delivery.postalCode": [NO_DELIVERY_ZONE],
    });
  }
}

/**
 * Crea un pedido público. Orden:
 *
 * 1. La ruta valida el cuerpo con Zod; aquí se calcula el hash canónico del cuerpo y del usuario
 *    de la sesión (si hay), para que la llave no sirva con otra sesión.
 * 2. Idempotencia (ADR-013) antes que nada: misma llave y mismo cuerpo → la respuesta guardada
 *    con el token derivado de nuevo, sin Turnstile ni cuotas (el token de Turnstile es de un solo
 *    uso y el reintento no crea nada); otro cuerpo → `IDEMPOTENCY_CONFLICT`.
 * 3. Turnstile y cuota por IP (30 por hora); el menú publicado por slug con la cuota por teléfono
 *    y sucursal (3 cada 10 min, ADR-010).
 * 4. Pedido de prueba si quien pide es miembro; `acceptingOrders` (T18, ADR-008), modalidad,
 *    mesa y zona; precios con el catálogo de D1 (`pricing.ts`) y tope del total de la sucursal.
 * 5. Un solo `db.batch`: pedido con su número, contador de la sucursal, líneas, historial
 *    `null → pending`, outbox `order.created` (salvo prueba sin dueño verificado) y la llave. Si
 *    otra petición registró la misma llave a la vez, el batch completo se revierte y se responde
 *    con lo que guardó la primera.
 */
export async function createOrder(
  deps: OrderDeps,
  idempotencyKey: string,
  input: OrderInput,
  now = new Date(),
): Promise<OrderResult> {
  const hash = await requestHash(PUBLIC_ORDER_SCOPE, { input, userId: deps.user?.id ?? null });
  const stored = await findStoredResponse(deps.db, idempotencyKey, PUBLIC_ORDER_SCOPE, hash);
  if (stored) return replay(deps, stored);

  await verifyTurnstile(deps.env, deps.turnstileToken, deps.clientIp);
  await consume(
    deps,
    "ip",
    `order-ip:${deps.clientIp ?? "unknown"}`,
    HOUR_MS,
    ORDERS_PER_IP_PER_HOUR,
    IP_QUOTA_MESSAGE,
  );

  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const checkout = await loadCheckout(
    deps,
    input.menuSlug,
    productIds,
    input.delivery?.postalCode ?? null,
    now,
  );
  const customerPhoneHash = await phoneHash(deps.env.PHONE_HASH_SALT, input.customer.phone);
  await consume(
    deps,
    "phone",
    `order-phone:${checkout.branchId}:${customerPhoneHash}`,
    TEN_MINUTES_MS,
    ORDERS_PER_PHONE_PER_10_MIN,
    PHONE_QUOTA_MESSAGE,
  );

  const isTest = await isTestOrder(deps, checkout);
  assertAccepting(checkout, isTest);
  assertModeRules(checkout, input);

  const pricing = priceOrder(checkout.catalog, input.items);
  if (!pricing.ok) throw new AppError("BUSINESS_RULE", ITEMS_CHANGED, pricing.fieldErrors);
  const deliveryFeeCents = input.mode === "delivery" ? (checkout.zone?.feeCents ?? 0) : 0;
  const totalCents = pricing.subtotalCents + deliveryFeeCents;
  if (checkout.maxOrderTotalCents !== null && totalCents > checkout.maxOrderTotalCents) {
    throw new AppError(
      "BUSINESS_RULE",
      `El pedido supera el máximo de ${formatMxn(checkout.maxOrderTotalCents)} que acepta esta sucursal. Quita algunos productos para continuar.`,
    );
  }

  const orderId = newId();
  const trackingToken = await orderTrackingToken(deps.env.ORDER_TOKEN_SECRET, orderId);
  const order: NewOrder = {
    id: orderId,
    orgId: checkout.orgId,
    branchId: checkout.branchId,
    menuId: checkout.menuId,
    mode: input.mode,
    tableNumber: input.mode === "table" ? (input.tableNumber ?? null) : null,
    customer: {
      name: input.customer.name,
      phone: input.customer.phone,
      phoneHash: customerPhoneHash,
      whatsappOptIn: input.customer.whatsappOptIn,
    },
    delivery:
      input.mode === "delivery" && input.delivery && checkout.zone
        ? {
            street: input.delivery.street,
            number: input.delivery.number,
            neighborhood: input.delivery.neighborhood,
            city: input.delivery.city,
            postalCode: input.delivery.postalCode,
            references: input.delivery.references ?? null,
            zoneId: checkout.zone.id,
          }
        : null,
    subtotalCents: pricing.subtotalCents,
    deliveryFeeCents,
    totalCents,
    notes: input.notes ?? null,
    isTest,
    trackingTokenHash: await hashToken(trackingToken),
    lines: pricing.lines.map((line) => ({ id: newId(), ...line })),
    historyId: newId(),
    // ADR-008: una cuenta sin dueño verificado no envía avisos, ni siquiera de prueba.
    outboxId: isTest && !checkout.hasVerifiedOwner ? null : newId(),
    now,
  };

  try {
    const [inserted] = await deps.db.batch([
      ...createOrderStatements(deps.db, order),
      ...storeResponseStatements(deps.db, {
        key: idempotencyKey,
        orgId: order.orgId,
        scope: PUBLIC_ORDER_SCOPE,
        hash,
        // La respuesta se arma en SQL: el número sale del pedido insertado en este batch.
        response: { statusCode: 201, body: storedOrderResponse(order) },
        now: now.getTime(),
      }),
    ]);
    const number = inserted[0]?.number;
    if (number === undefined) throw new Error("El pedido no devolvió su número.");
    log.info("order.created", { requestId: deps.requestId, orgId: order.orgId, isTest });
    return {
      statusCode: 201,
      body: { number, status: "pending", totalCents, trackingToken },
      replayed: false,
    };
  } catch (error) {
    // Otra petición con la misma llave pudo registrar el pedido entre la consulta y el batch.
    const winner = await findStoredResponse(deps.db, idempotencyKey, PUBLIC_ORDER_SCOPE, hash);
    if (winner) return replay(deps, winner);
    log.error("order.batch_failed", { requestId: deps.requestId, orgId: order.orgId });
    throw error;
  }
}
