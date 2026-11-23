import {
  CategoryDto,
  ErrorResponse,
  FINAL_STATUSES,
  OrderCreatedDto,
  ORDER_STATUSES,
  ProductDto,
  PublicOrderDto,
} from "@menu-max/contracts";
import {
  branches,
  businesses,
  idempotencyKeys,
  notificationOutbox,
  orderItems,
  orders,
  orderStatusHistory,
  organizations,
  subscriptions,
  users,
} from "@menu-max/database";
import { env } from "cloudflare:workers";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addMember, createBranch, createOrg, createUser } from "../../../test/factories";
import { callApi } from "../../../test/isolation";
import { getEnv } from "../../env";
import { createDb } from "../../infrastructure/db";
import { hashToken, orderTrackingToken } from "../../shared/ids";
import {
  NO_DELIVERY_ZONE,
  ORDER_NOT_FOUND,
  PHONE_QUOTA_MESSAGE,
  TABLE_OUT_OF_RANGE,
} from "./orders.service";
import { PRODUCT_UNAVAILABLE, VARIANT_UNAVAILABLE } from "./pricing";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const FAILING_TURNSTILE = "2x0000000000000000000000000000000AA";
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  const used = new Set<string>();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.href !== SITEVERIFY) throw new Error("Petición externa inesperada.");
    // Clave de prueba que siempre pasa, salvo tokens reutilizados o el de "siempre falla".
    const form = init?.body;
    const token = form instanceof FormData ? String(form.get("response")) : "";
    const rejected = used.has(token) || token === FAILING_TURNSTILE;
    used.add(token);
    return Promise.resolve(
      Response.json(
        rejected
          ? { success: false, "error-codes": ["timeout-or-duplicate"] }
          : { success: true, "error-codes": [] },
      ),
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const db = () => createDb(getEnv(env));

async function expectError(response: Response, status: number, code: ErrorResponse["code"]) {
  expect(response.status).toBe(status);
  const body = ErrorResponse.parse(await response.json());
  expect(body.code).toBe(code);
  return body;
}

async function ok<T>(response: Response, status: number, schema: { parse: (v: unknown) => T }) {
  const text = await response.text();
  expect(response.status, text).toBe(status);
  return schema.parse(JSON.parse(text));
}

/** Teléfono E.164 único: la cuota por teléfono no cruza pruebas. */
function newPhone() {
  const digits = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b % 10).join("");
  return `+5255${digits}`;
}

/** Id de la opción `index` del grupo `group` del producto. */
function option(product: ProductDto, group: number, index: number) {
  return product.optionGroups[group]?.options[index]?.id ?? "";
}

type ShopOptions = {
  open?: boolean;
  maxOrderTotalCents?: number;
};

/**
 * Sucursal publicada con todo lo que usa un pedido: las tres modalidades, 10 mesas, una zona
 * (06700 y 06100, $35), horario de todo el día y dos productos:
 * - Taco al pastor, $25: «Salsa» (elige 1: Verde, Roja) y «Extras» (hasta 2: Queso +$10, Cebolla asada +$5);
 * - Agua de horchata con variantes Chica $25 y Grande $40.
 */
async function shop(options: ShopOptions = {}) {
  const owner = await createUser();
  const org = await createOrg({ ownerId: owner.id });
  await db()
    .update(businesses)
    .set({ name: `Tacos ${crypto.randomUUID().slice(0, 8)}` })
    .where(eq(businesses.id, org.businessId));
  const branchId = await createBranch({ orgId: org.orgId, businessId: org.businessId });
  const base = `/v1/orgs/${org.orgId}`;
  const menu = `${base}/branches/${branchId}/menu`;
  const cookie = owner.cookie;

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await callApi(method, path, { cookie, body });
    expect(response.status, await response.clone().text()).toBeLessThan(300);
    return response;
  };

  await call("PATCH", `${base}/branches/${branchId}`, {
    version: 1,
    modes: { table: true, pickup: true, delivery: true },
    tableCount: 10,
    maxOrderTotalCents: options.maxOrderTotalCents ?? null,
  });
  if (options.open !== false) {
    await call("PUT", `${base}/branches/${branchId}/hours`, {
      ranges: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        opensAt: "00:00",
        closesAt: "24:00",
      })),
    });
  }
  await call("POST", `${base}/branches/${branchId}/zones`, {
    name: "Centro",
    postalCodes: ["06700", "06100"],
    feeCents: 3_500,
  });
  const category = CategoryDto.parse(
    await (await call("POST", `${menu}/categories`, { name: "Tacos" })).json(),
  );
  const taco = ProductDto.parse(
    await (
      await call("POST", `${menu}/products`, {
        categoryId: category.id,
        name: "Taco al pastor",
        priceCents: 2_500,
        optionGroups: [
          {
            name: "Salsa",
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: "Verde", priceDeltaCents: 0 },
              { name: "Roja", priceDeltaCents: 0 },
            ],
          },
          {
            name: "Extras",
            minSelect: 0,
            maxSelect: 2,
            options: [
              { name: "Queso", priceDeltaCents: 1_000 },
              { name: "Cebolla asada", priceDeltaCents: 500 },
            ],
          },
        ],
      })
    ).json(),
  );
  const agua = ProductDto.parse(
    await (
      await call("POST", `${menu}/products`, {
        categoryId: category.id,
        name: "Agua de horchata",
        priceCents: 3_000,
        variants: [
          { name: "Chica", priceCents: 2_500 },
          { name: "Grande", priceCents: 4_000 },
        ],
      })
    ).json(),
  );
  const publication = (await (await call("POST", `${menu}/publish`)).json()) as { slug: string };

  return {
    owner,
    org,
    branchId,
    base,
    menu,
    slug: publication.slug,
    taco,
    agua,
    verde: option(taco, 0, 0),
    roja: option(taco, 0, 1),
    queso: option(taco, 1, 0),
    chica: agua.variants[0]?.id ?? "",
    grande: agua.variants[1]?.id ?? "",
  };
}

type Shop = Awaited<ReturnType<typeof shop>>;

function orderBody(s: Shop, overrides: Record<string, unknown> = {}) {
  return {
    menuSlug: s.slug,
    mode: "pickup",
    items: [{ productId: s.taco.id, optionIds: [s.verde], quantity: 2 }],
    customer: { name: "Ana López", phone: newPhone(), whatsappOptIn: true },
    ...overrides,
  };
}

function postOrder(
  body: unknown,
  options: { key?: string; turnstile?: string | null; cookie?: string; ip?: string } = {},
) {
  const headers = new Headers({ "idempotency-key": options.key ?? crypto.randomUUID() });
  if (options.turnstile !== null) {
    headers.set("x-turnstile-token", options.turnstile ?? crypto.randomUUID());
  }
  if (options.ip) headers.set("x-client-ip", options.ip);
  return callApi("POST", "/v1/public/orders", { body, headers, cookie: options.cookie });
}

async function created(body: unknown, options: Parameters<typeof postOrder>[1] = {}) {
  return ok(await postOrder(body, options), 201, OrderCreatedDto);
}

async function ordersOf(branchId: string) {
  return db().select().from(orders).where(eq(orders.branchId, branchId)).orderBy(orders.number);
}

async function onlyOrder(branchId: string) {
  const rows = await ordersOf(branchId);
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (!row) throw new Error("Sin pedido");
  return row;
}

async function outboxOf(orgId: string) {
  return db().select().from(notificationOutbox).where(eq(notificationOutbox.organizationId, orgId));
}

async function setOwnerVerified(s: Shop, emailVerified: boolean) {
  await db().update(users).set({ emailVerified }).where(eq(users.id, s.owner.id));
}

describe("POST /v1/public/orders: caso feliz", () => {
  it("pedido para recoger: total calculado por la API, líneas con copia, historial y outbox", async () => {
    const s = await shop();
    const body = orderBody(s, {
      items: [
        { productId: s.taco.id, optionIds: [s.roja, s.queso], quantity: 3, notes: "Sin piña" },
        { productId: s.agua.id, variantId: s.grande, optionIds: [], quantity: 1 },
      ],
      notes: "Tocar el timbre",
    });
    const dto = await created(body);
    expect(dto).toMatchObject({ number: 1, status: "pending", totalCents: 3 * 3_500 + 4_000 });

    const order = await onlyOrder(s.branchId);
    expect(order).toMatchObject({
      organizationId: s.org.orgId,
      mode: "pickup",
      tableNumber: null,
      subtotalCents: 14_500,
      deliveryFeeCents: 0,
      totalCents: 14_500,
      currency: "MXN",
      paymentMethod: "cash",
      isTest: false,
      customerName: "Ana López",
      customerWhatsappOptIn: true,
      notes: "Tocar el timbre",
      version: 1,
    });
    expect(order.customerPhoneHash).toMatch(/^[0-9a-f]{64}$/);

    const items = await db().select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(
      items.map(({ productName, variantName, unitPriceCents, quantity, lineTotalCents }) => ({
        productName,
        variantName,
        unitPriceCents,
        quantity,
        lineTotalCents,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          productName: "Taco al pastor",
          variantName: null,
          unitPriceCents: 3_500,
          quantity: 3,
          lineTotalCents: 10_500,
        },
        {
          productName: "Agua de horchata",
          variantName: "Grande",
          unitPriceCents: 4_000,
          quantity: 1,
          lineTotalCents: 4_000,
        },
      ]),
    );
    const tacoLine = items.find((item) => item.productId === s.taco.id);
    expect(tacoLine?.notes).toBe("Sin piña");
    expect(tacoLine?.optionsSnapshot.map((snapshot) => snapshot.name)).toEqual(["Roja", "Queso"]);

    const history = await db()
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, order.id));
    expect(history).toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: "pending", actorMemberId: null }),
    ]);
    expect(await outboxOf(s.org.orgId)).toEqual([
      expect.objectContaining({
        event: "order.created",
        status: "pending",
        payloadJson: { orderId: order.id },
        publishedAt: null,
      }),
    ]);
  });

  it("pedido en mesa guarda la mesa", async () => {
    const s = await shop();
    const dto = await created(orderBody(s, { mode: "table", tableNumber: 10 }));
    expect(dto.totalCents).toBe(5_000);
    expect(await onlyOrder(s.branchId)).toMatchObject({ mode: "table", tableNumber: 10 });
  });

  it("pedido a domicilio suma la tarifa de la zona del código postal y copia la dirección", async () => {
    const s = await shop();
    const delivery = {
      street: "Av. Insurgentes Sur",
      number: "123 int. 4",
      neighborhood: "Roma Norte",
      city: "Ciudad de México",
      postalCode: "06700",
      references: "Portón negro",
    };
    const dto = await created(orderBody(s, { mode: "delivery", delivery }));
    expect(dto.totalCents).toBe(5_000 + 3_500);
    const order = await onlyOrder(s.branchId);
    expect(order).toMatchObject({
      mode: "delivery",
      subtotalCents: 5_000,
      deliveryFeeCents: 3_500,
      totalCents: 8_500,
      deliveryStreet: delivery.street,
      deliveryNumber: delivery.number,
      deliveryNeighborhood: delivery.neighborhood,
      deliveryCity: delivery.city,
      deliveryPostalCode: "06700",
      deliveryReferences: "Portón negro",
    });
    expect(order.deliveryZoneId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("los números son consecutivos por sucursal, también con pedidos simultáneos", async () => {
    const s = await shop();
    const other = await shop();
    const responses = await Promise.all(Array.from({ length: 6 }, () => created(orderBody(s))));
    const numbers = responses.map((dto) => dto.number);
    numbers.sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await created(orderBody(other))).number).toBe(1);
    const [branch] = await db().select().from(branches).where(eq(branches.id, s.branchId));
    expect(branch?.nextOrderNumber).toBe(7);
  });
});

describe("POST /v1/public/orders: validación", () => {
  it.each([
    ["un total", (s: Shop) => orderBody(s, { totalCents: 1 })],
    [
      "un precio en el ítem",
      (s: Shop) =>
        orderBody(s, {
          items: [{ productId: s.taco.id, optionIds: [s.verde], quantity: 1, priceCents: 1 }],
        }),
    ],
    ["un estado", (s: Shop) => orderBody(s, { status: "delivered" })],
    ["la organización", (s: Shop) => orderBody(s, { organizationId: s.org.orgId })],
  ])("rechaza %s en el cuerpo (objeto estricto)", async (_, build) => {
    const s = await shop();
    await expectError(await postOrder(build(s)), 400, "VALIDATION_FAILED");
    expect(await ordersOf(s.branchId)).toHaveLength(0);
  });

  it.each([
    ["mesa sin número", { mode: "table" }, "tableNumber"],
    ["número de mesa fuera de mesa", { mode: "pickup", tableNumber: 2 }, "tableNumber"],
    ["domicilio sin dirección", { mode: "delivery" }, "delivery"],
    ["un pedido sin productos", { items: [] }, "items"],
  ])("rechaza %s", async (_, overrides, field) => {
    const s = await shop();
    const body = await expectError(
      await postOrder(orderBody(s, overrides)),
      400,
      "VALIDATION_FAILED",
    );
    expect(Object.keys(body.fieldErrors ?? {})).toContain(field);
  });

  it("rechaza una llave de idempotencia faltante o sin formato UUID", async () => {
    const s = await shop();
    const missing = await callApi("POST", "/v1/public/orders", {
      body: orderBody(s),
      headers: { "x-turnstile-token": crypto.randomUUID() },
    });
    await expectError(missing, 400, "VALIDATION_FAILED");
    await expectError(
      await postOrder(orderBody(s), { key: "no-es-uuid" }),
      400,
      "VALIDATION_FAILED",
    );
  });

  it("Turnstile faltante, inválido o reutilizado → 400 y no se crea nada", async () => {
    const s = await shop();
    await expectError(await postOrder(orderBody(s), { turnstile: null }), 400, "VALIDATION_FAILED");
    await expectError(
      await postOrder(orderBody(s), { turnstile: FAILING_TURNSTILE }),
      400,
      "VALIDATION_FAILED",
    );
    const token = crypto.randomUUID();
    await created(orderBody(s), { turnstile: token });
    await expectError(
      await postOrder(orderBody(s), { turnstile: token }),
      400,
      "VALIDATION_FAILED",
    );
    expect(await ordersOf(s.branchId)).toHaveLength(1);
  });

  it("menú inexistente → 404", async () => {
    const s = await shop();
    await expectError(
      await postOrder(orderBody(s, { menuSlug: "no-existe-este-menu" })),
      404,
      "NOT_FOUND",
    );
  });
});

/** El pedido se rechaza con un solo error, en el ítem y el campo indicados, y no se escribe. */
async function itemError(s: Shop, items: unknown[], field: string, message: string) {
  const body = await expectError(await postOrder(orderBody(s, { items })), 422, "BUSINESS_RULE");
  expect(body.fieldErrors).toEqual({ [field]: [message] });
  expect(await ordersOf(s.branchId)).toHaveLength(0);
}

describe("POST /v1/public/orders: catálogo", () => {
  it("producto no disponible → error en su ítem", async () => {
    const s = await shop();
    const response = await callApi("PATCH", `${s.menu}/products/${s.agua.id}/availability`, {
      cookie: s.owner.cookie,
      body: { version: s.agua.version, available: false },
    });
    expect(response.status).toBe(200);
    await itemError(
      s,
      [
        { productId: s.taco.id, optionIds: [s.verde], quantity: 1 },
        { productId: s.agua.id, variantId: s.chica, optionIds: [], quantity: 1 },
      ],
      "items.1.productId",
      PRODUCT_UNAVAILABLE,
    );
  });

  it("producto borrado → error en su ítem", async () => {
    const s = await shop();
    const response = await callApi("DELETE", `${s.menu}/products/${s.agua.id}`, {
      cookie: s.owner.cookie,
    });
    expect(response.status).toBeLessThan(300);
    await itemError(
      s,
      [{ productId: s.agua.id, variantId: s.chica, optionIds: [], quantity: 1 }],
      "items.0.productId",
      PRODUCT_UNAVAILABLE,
    );
  });

  it("producto de otro menú → error en su ítem", async () => {
    const s = await shop();
    const other = await shop();
    await itemError(
      s,
      [
        { productId: s.taco.id, optionIds: [s.verde], quantity: 1 },
        { productId: s.taco.id, optionIds: [s.verde], quantity: 1 },
        { productId: other.taco.id, optionIds: [other.verde], quantity: 1 },
      ],
      "items.2.productId",
      PRODUCT_UNAVAILABLE,
    );
  });

  it("variante de otro producto → error en su ítem", async () => {
    const s = await shop();
    const other = await shop();
    await itemError(
      s,
      [{ productId: s.agua.id, variantId: other.grande, optionIds: [], quantity: 1 }],
      "items.0.variantId",
      VARIANT_UNAVAILABLE,
    );
  });

  it("total mayor al tope de la sucursal → 422", async () => {
    const s = await shop({ maxOrderTotalCents: 10_000 });
    await created(
      orderBody(s, { items: [{ productId: s.taco.id, optionIds: [s.verde], quantity: 4 }] }),
    );
    const body = await expectError(
      await postOrder(
        orderBody(s, { items: [{ productId: s.taco.id, optionIds: [s.verde], quantity: 5 }] }),
      ),
      422,
      "BUSINESS_RULE",
    );
    expect(body.message).toContain("$100.00");
  });

  it("el total sale del catálogo de D1 en el momento del pedido", async () => {
    const s = await shop();
    const response = await callApi("PATCH", `${s.menu}/products/${s.taco.id}`, {
      cookie: s.owner.cookie,
      body: { version: s.taco.version, priceCents: 3_100 },
    });
    expect(response.status).toBe(200);
    expect((await created(orderBody(s))).totalCents).toBe(6_200);
  });
});

describe("POST /v1/public/orders: reglas de la sucursal", () => {
  it("sucursal cerrada → 422 con mensaje accionable", async () => {
    const s = await shop({ open: false });
    const body = await expectError(await postOrder(orderBody(s)), 422, "BUSINESS_RULE");
    expect(body.message).toMatch(/cerrada/);
  });

  it("modalidad apagada → 422 en `mode`", async () => {
    const s = await shop();
    const [branch] = await db().select().from(branches).where(eq(branches.id, s.branchId));
    const response = await callApi("PATCH", `${s.base}/branches/${s.branchId}`, {
      cookie: s.owner.cookie,
      body: { version: branch?.version, modes: { table: false, pickup: true, delivery: true } },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await expectError(
      await postOrder(orderBody(s, { mode: "table", tableNumber: 1 })),
      422,
      "BUSINESS_RULE",
    );
    expect(Object.keys(body.fieldErrors ?? {})).toEqual(["mode"]);
  });

  it("mesa fuera de rango → 422 en `tableNumber`", async () => {
    const s = await shop();
    const body = await expectError(
      await postOrder(orderBody(s, { mode: "table", tableNumber: 11 })),
      422,
      "BUSINESS_RULE",
    );
    expect(body.fieldErrors).toEqual({ tableNumber: [TABLE_OUT_OF_RANGE] });
  });

  it("código postal sin zona → 422 «No entregamos en ese código postal.»", async () => {
    const s = await shop();
    const delivery = {
      street: "Calle 5",
      number: "10",
      neighborhood: "Del Valle",
      city: "Ciudad de México",
      postalCode: "03100",
    };
    const body = await expectError(
      await postOrder(orderBody(s, { mode: "delivery", delivery })),
      422,
      "BUSINESS_RULE",
    );
    expect(body.message).toBe(NO_DELIVERY_ZONE);
    expect(body.fieldErrors).toEqual({ "delivery.postalCode": [NO_DELIVERY_ZONE] });
  });
});

describe("POST /v1/public/orders: cuenta sin verificar y pedidos de prueba", () => {
  it("cuenta sin verificar → rechazo para el comensal", async () => {
    const s = await shop();
    await setOwnerVerified(s, false);
    const body = await expectError(await postOrder(orderBody(s)), 422, "BUSINESS_RULE");
    expect(body.message).toMatch(/todavía no recibe pedidos/);
  });

  it("con sesión de un miembro, sin verificar y cerrada → pedido de prueba sin aviso", async () => {
    const s = await shop({ open: false });
    await setOwnerVerified(s, false);
    await created(orderBody(s), { cookie: s.owner.cookie });
    expect(await onlyOrder(s.branchId)).toMatchObject({ isTest: true });
    expect(await outboxOf(s.org.orgId)).toHaveLength(0);
  });

  it("con dueño verificado, el pedido de prueba sí genera aviso", async () => {
    const s = await shop();
    await created(orderBody(s), { cookie: s.owner.cookie });
    expect(await onlyOrder(s.branchId)).toMatchObject({ isTest: true });
    expect(await outboxOf(s.org.orgId)).toHaveLength(1);
  });

  it("staff de esa sucursal → prueba; staff de otra sucursal u otra organización → comensal", async () => {
    const s = await shop({ open: false });
    await setOwnerVerified(s, false);
    const otherBranch = await createBranch({ orgId: s.org.orgId, businessId: s.org.businessId });
    const staffHere = await createUser();
    await addMember({
      orgId: s.org.orgId,
      userId: staffHere.id,
      role: "staff",
      branchIds: [s.branchId],
    });
    const staffThere = await createUser();
    await addMember({
      orgId: s.org.orgId,
      userId: staffThere.id,
      role: "staff",
      branchIds: [otherBranch],
    });
    const stranger = await shop();

    await expectError(
      await postOrder(orderBody(s), { cookie: staffThere.cookie }),
      422,
      "BUSINESS_RULE",
    );
    await expectError(
      await postOrder(orderBody(s), { cookie: stranger.owner.cookie }),
      422,
      "BUSINESS_RULE",
    );
    await created(orderBody(s), { cookie: staffHere.cookie });
    expect(await onlyOrder(s.branchId)).toMatchObject({ isTest: true });
  });

  it("el pedido de prueba no salta la suscripción suspendida ni la gracia vencida", async () => {
    // Suspendida después de armar el menú: con la suscripción suspendida el panel no escribe.
    const suspended = await shop();
    await db()
      .update(subscriptions)
      .set({ status: "suspended" })
      .where(eq(subscriptions.organizationId, suspended.org.orgId));
    await expectError(
      await postOrder(orderBody(suspended), { cookie: suspended.owner.cookie }),
      422,
      "BUSINESS_RULE",
    );

    const expired = await shop();
    await setOwnerVerified(expired, false);
    await db()
      .update(organizations)
      .set({ createdAt: new Date(Date.now() - 30 * DAY_MS) })
      .where(eq(organizations.id, expired.org.orgId));
    const body = await expectError(
      await postOrder(orderBody(expired), { cookie: expired.owner.cookie }),
      422,
      "BUSINESS_RULE",
    );
    expect(body.message).toMatch(/aún no está activo/);
  });

  it("is_test no se toma del cuerpo", async () => {
    const s = await shop();
    await expectError(await postOrder(orderBody(s, { isTest: true })), 400, "VALIDATION_FAILED");
  });
});

describe("POST /v1/public/orders: idempotencia y token", () => {
  it("misma llave y cuerpo → un solo pedido y la misma respuesta, sin volver a pedir Turnstile", async () => {
    const s = await shop();
    const key = crypto.randomUUID();
    const turnstile = crypto.randomUUID();
    const body = orderBody(s);
    const first = await created(body, { key, turnstile });
    // El navegador reenvía el mismo formulario con el mismo token (ya consumido) y sin él.
    expect(await created(body, { key, turnstile })).toEqual(first);
    expect(await created(body, { key, turnstile: null })).toEqual(first);
    expect(await ordersOf(s.branchId)).toHaveLength(1);
  });

  it("el reintento responde lo guardado aunque la sucursal haya cerrado después", async () => {
    const s = await shop();
    const key = crypto.randomUUID();
    const body = orderBody(s);
    const first = await created(body, { key });
    const response = await callApi("PUT", `${s.base}/branches/${s.branchId}/hours`, {
      cookie: s.owner.cookie,
      body: { ranges: [] },
    });
    expect(response.status).toBe(200);
    expect(await created(body, { key })).toEqual(first);
  });

  it("misma llave con otro cuerpo → 409 IDEMPOTENCY_CONFLICT", async () => {
    const s = await shop();
    const key = crypto.randomUUID();
    const body = orderBody(s);
    await created(body, { key });
    await expectError(
      await postOrder({ ...body, notes: "Otra cosa" }, { key }),
      409,
      "IDEMPOTENCY_CONFLICT",
    );
    // La misma llave con otra sesión tampoco sirve.
    await expectError(
      await postOrder(body, { key, cookie: s.owner.cookie }),
      409,
      "IDEMPOTENCY_CONFLICT",
    );
    expect(await ordersOf(s.branchId)).toHaveLength(1);
  });

  it("envíos simultáneos con la misma llave → un solo pedido, todos con la misma respuesta", async () => {
    const s = await shop();
    const key = crypto.randomUUID();
    const body = orderBody(s);
    // Tres: cada envío que pasa la consulta rápida cuenta en la cuota de 3 por teléfono.
    const responses = await Promise.all(Array.from({ length: 3 }, () => created(body, { key })));
    for (const response of responses) expect(response).toEqual(responses[0]);
    expect(await ordersOf(s.branchId)).toHaveLength(1);
  });

  it("la base solo guarda el hash del token, y el token del reintento abre el pedido", async () => {
    const s = await shop();
    const key = crypto.randomUUID();
    const body = orderBody(s);
    const { trackingToken } = await created(body, { key });
    const order = await onlyOrder(s.branchId);

    expect(order.trackingTokenHash).toBe(await hashToken(trackingToken));
    expect(trackingToken).toBe(await orderTrackingToken(getEnv(env).ORDER_TOKEN_SECRET, order.id));
    const [stored] = await db().select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key));
    expect(stored?.responseJson).toEqual({
      orderId: order.id,
      number: 1,
      status: "pending",
      totalCents: 5_000,
    });
    expect(JSON.stringify(stored)).not.toContain(trackingToken);
    expect(JSON.stringify(order)).not.toContain(trackingToken);

    const replay = await created(body, { key });
    expect(replay.trackingToken).toBe(trackingToken);
    const [found] = await db()
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.trackingTokenHash, await hashToken(replay.trackingToken)));
    expect(found?.id).toBe(order.id);
  });
});

describe("POST /v1/public/orders: cuotas", () => {
  it("cuarto pedido en 10 minutos del mismo teléfono en la misma sucursal → 429", async () => {
    const s = await shop();
    const other = await shop();
    const phone = newPhone();
    const customer = { name: "Ana López", phone, whatsappOptIn: false };
    await Promise.all(Array.from({ length: 3 }, () => created(orderBody(s, { customer }))));
    const response = await postOrder(orderBody(s, { customer }));
    const body = await expectError(response, 429, "RATE_LIMITED");
    expect(body.message).toBe(PHONE_QUOTA_MESSAGE);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    // La cuota es por sucursal: el mismo teléfono puede pedir en otra.
    await created(orderBody(other, { customer }));
    expect(await ordersOf(s.branchId)).toHaveLength(3);
  });

  it("pedido 31 en una hora desde la misma IP → 429", async () => {
    const s = await shop();
    const ip = `2001:db8::${crypto.randomUUID().slice(0, 4)}:1`;
    // La cuota se cuenta antes de las reglas del negocio: basta con pedidos que no pasan.
    const rejected = await Promise.all(
      Array.from({ length: 30 }, () =>
        postOrder(orderBody(s, { mode: "table", tableNumber: 99 }), { ip }),
      ),
    );
    expect(rejected.map((response) => response.status)).toEqual(Array(30).fill(422));
    await expectError(await postOrder(orderBody(s), { ip }), 429, "RATE_LIMITED");
  });
});

describe("POST /v1/public/orders: atomicidad", () => {
  it("si una sentencia del batch falla a mitad, no se escribe nada", async () => {
    const s = await shop();
    const key = crypto.randomUUID();
    // El outbox va después del pedido, las líneas y el historial: falla a mitad del batch.
    await env.DB.prepare(
      "CREATE TRIGGER t21_falla_outbox BEFORE INSERT ON notification_outbox BEGIN SELECT RAISE(ABORT, 'falla simulada'); END",
    ).run();
    try {
      await expectError(await postOrder(orderBody(s), { key }), 500, "INTERNAL");
    } finally {
      await env.DB.prepare("DROP TRIGGER t21_falla_outbox").run();
    }
    expect(await ordersOf(s.branchId)).toHaveLength(0);
    const counts = await db()
      .select({
        items: sql<number>`(select count(*) from ${orderItems} where ${orderItems.organizationId} = ${s.org.orgId})`,
        history: sql<number>`(select count(*) from ${orderStatusHistory} where ${orderStatusHistory.organizationId} = ${s.org.orgId})`,
        keys: sql<number>`(select count(*) from ${idempotencyKeys} where ${idempotencyKeys.key} = ${key})`,
      })
      .from(branches)
      .where(and(eq(branches.organizationId, s.org.orgId), eq(branches.id, s.branchId)));
    expect(counts).toEqual([{ items: 0, history: 0, keys: 0 }]);
    const [branch] = await db().select().from(branches).where(eq(branches.id, s.branchId));
    expect(branch?.nextOrderNumber).toBe(1);

    // Sin la falla, el reintento con la misma llave crea el pedido con el número 1.
    expect((await created(orderBody(s), { key })).number).toBe(1);
  });
});

function track(token: string, headers?: HeadersInit) {
  return callApi("GET", `/v1/public/orders/${token}`, { headers });
}

/** Transición simulada: el endpoint real es de T23. */
async function transition(orderId: string, from: "pending", to: "accepted", at: Date) {
  const [row] = await db().select().from(orders).where(eq(orders.id, orderId));
  if (!row) throw new Error("Sin pedido");
  await db()
    .update(orders)
    .set({ status: to, version: row.version + 1, updatedAt: at })
    .where(and(eq(orders.organizationId, row.organizationId), eq(orders.id, orderId)));
  await db().insert(orderStatusHistory).values({
    id: crypto.randomUUID(),
    organizationId: row.organizationId,
    orderId,
    fromStatus: from,
    toStatus: to,
    createdAt: at,
  });
}

describe("GET /v1/public/orders/:token", () => {
  it("token válido → DTO con líneas en orden, historial y datos de la sucursal", async () => {
    const s = await shop();
    await db()
      .update(branches)
      .set({ contactPhone: "+525500000000" })
      .where(and(eq(branches.organizationId, s.org.orgId), eq(branches.id, s.branchId)));
    const { trackingToken } = await created(
      orderBody(s, {
        mode: "table",
        tableNumber: 4,
        items: [
          { productId: s.taco.id, optionIds: [s.verde], quantity: 2 },
          { productId: s.agua.id, variantId: s.grande, optionIds: [], quantity: 1 },
        ],
      }),
    );
    const response = await track(trackingToken);
    const dto = await ok(response, 200, PublicOrderDto);
    const order = await onlyOrder(s.branchId);
    const [business] = await db()
      .select()
      .from(businesses)
      .where(eq(businesses.id, s.org.businessId));

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("etag")).toBe('"1"');
    expect(dto).toMatchObject({
      number: 1,
      status: "pending",
      isFinal: false,
      mode: "table",
      tableNumber: 4,
      deliveryNeighborhood: null,
      totalCents: 9_000,
      createdAt: order.createdAt.toISOString(),
      businessName: business?.name,
      contactPhone: "+525500000000",
      items: [
        { name: "Taco al pastor", variantName: null, quantity: 2 },
        { name: "Agua de horchata", variantName: "Grande", quantity: 1 },
      ],
      history: [{ status: "pending", at: order.createdAt.toISOString() }],
    });
  });

  it("a domicilio: solo la colonia; ningún dato personal del comensal", async () => {
    const s = await shop();
    const phone = newPhone();
    const { trackingToken } = await created(
      orderBody(s, {
        mode: "delivery",
        customer: { name: "Ana López", phone, whatsappOptIn: true },
        delivery: {
          street: "Calle Ficticia",
          number: "742",
          neighborhood: "Centro",
          city: "Ciudad de México",
          postalCode: "06700",
          references: "Portón azul",
        },
        notes: "Tocar el timbre",
      }),
    );
    const response = await track(trackingToken);
    const raw = await response.clone().text();
    const dto = await ok(response, 200, PublicOrderDto);

    expect(dto.deliveryNeighborhood).toBe("Centro");
    for (const secret of [
      phone,
      "Ana López",
      "Calle Ficticia",
      "742",
      "06700",
      "Portón azul",
      "Tocar el timbre",
      "customerPhone",
      s.org.orgId,
      s.branchId,
    ]) {
      expect(raw).not.toContain(secret);
    }
    expect(PublicOrderDto.safeParse({ ...dto, customerPhone: phone }).success).toBe(false);
    expect(PublicOrderDto.safeParse({ ...dto, deliveryStreet: "Calle" }).success).toBe(false);
  });

  it("token inexistente, corto o largo → el mismo 404, siempre pasando por el hash", async () => {
    const digest = vi.spyOn(crypto.subtle, "digest");
    const tokens = ["A".repeat(43), "corto", "B".repeat(512), "no%20valido"];
    const bodies = await Promise.all(
      tokens.map(async (token) => expectError(await track(token), 404, "NOT_FOUND")),
    );
    for (const body of bodies) expect(body.message).toBe(ORDER_NOT_FOUND);
    const hashed = digest.mock.calls.map(([, data]) =>
      new TextDecoder().decode(data as Uint8Array),
    );
    for (const token of [tokens[0], tokens[1], tokens[2], "no valido"]) {
      expect(hashed).toContain(token);
    }
  });

  it("el token de un pedido no abre otro", async () => {
    const first = await shop();
    const second = await shop();
    const a = await created(orderBody(first));
    const b = await created(orderBody(second));
    const dtoA = await ok(await track(a.trackingToken), 200, PublicOrderDto);
    const dtoB = await ok(await track(b.trackingToken), 200, PublicOrderDto);
    expect(dtoA.businessName).not.toBe(dtoB.businessName);
  });

  it("ETag sin cambios → 304; tras una transición → 200 con nuevo ETag e historial", async () => {
    const s = await shop();
    const { trackingToken } = await created(orderBody(s));
    const first = await track(trackingToken);
    const etag = first.headers.get("etag") ?? "";

    const same = await track(trackingToken, { "if-none-match": etag });
    expect(same.status).toBe(304);
    expect(await same.text()).toBe("");
    expect(same.headers.get("etag")).toBe(etag);
    expect(same.headers.get("cache-control")).toBe("no-store");
    expect((await track(trackingToken, { "if-none-match": `W/${etag}` })).status).toBe(304);

    const order = await onlyOrder(s.branchId);
    await transition(order.id, "pending", "accepted", new Date(order.createdAt.getTime() + 1_000));
    const changed = await track(trackingToken, { "if-none-match": etag });
    const dto = await ok(changed, 200, PublicOrderDto);
    expect(changed.headers.get("etag")).toBe('"2"');
    expect(dto.status).toBe("accepted");
    expect(dto.history.map((entry) => entry.status)).toEqual(["pending", "accepted"]);
  });

  it("isFinal coincide con FINAL_STATUSES en cada estado", async () => {
    const s = await shop();
    await Promise.all(
      ORDER_STATUSES.map(async (status) => {
        const { trackingToken } = await created(orderBody(s));
        await db()
          .update(orders)
          .set({ status })
          .where(
            and(
              eq(orders.organizationId, s.org.orgId),
              eq(orders.trackingTokenHash, await hashToken(trackingToken)),
            ),
          );
        const dto = await ok(await track(trackingToken), 200, PublicOrderDto);
        expect(dto.isFinal, status).toBe((FINAL_STATUSES as readonly string[]).includes(status));
      }),
    );
  });

  it("sigue disponible con la suscripción suspendida", async () => {
    const s = await shop();
    const { trackingToken } = await created(orderBody(s));
    await db()
      .update(subscriptions)
      .set({ status: "suspended" })
      .where(eq(subscriptions.organizationId, s.org.orgId));
    await ok(await track(trackingToken), 200, PublicOrderDto);
  });
});
