import { CategoryDto, ErrorResponse, MenuPublicationDto } from "@menu-max/contracts";
import { branches, businesses } from "@menu-max/database";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { renderSVG } from "uqr";
import { describe, expect, it } from "vitest";
import { addMember, createBranch, createOrg, createUser } from "../../../test/factories";
import { callApi, expectNotFoundForOtherTenant } from "../../../test/isolation";
import { getEnv } from "../../env";
import { createDb } from "../../infrastructure/db";
import { QR_MENU_NOT_PUBLISHED, QR_NO_TABLES } from "./storefront.service";

// QR del menú y por mesa (T19, ADR-017).

const db = () => createDb(getEnv(env));
const WEB_ORIGIN = getEnv(env).WEB_ORIGIN;
/** Margen de ADR-017, en módulos. */
const BORDER = 4;

async function expectError(response: Response, status: number, code: ErrorResponse["code"]) {
  expect(response.status).toBe(status);
  const body = ErrorResponse.parse(await response.json());
  expect(body.code).toBe(code);
  return body;
}

/** Organización con owner, admin y staff (asignado a la sucursal), y una sucursal con 3 mesas. */
async function setup() {
  const owner = await createUser();
  const org = await createOrg({ ownerId: owner.id });
  // El slug es global y la D1 se comparte en el archivo: nombre único por prueba.
  await db()
    .update(businesses)
    .set({ name: `Tacos El Güero ${crypto.randomUUID().slice(0, 8)}` })
    .where(eq(businesses.id, org.businessId));
  const branchId = await createBranch({ orgId: org.orgId, businessId: org.businessId });
  await setTableCount(branchId, 3);
  const admin = await createUser();
  await addMember({ orgId: org.orgId, userId: admin.id, role: "admin" });
  const staff = await createUser();
  await addMember({ orgId: org.orgId, userId: staff.id, role: "staff", branchIds: [branchId] });
  const base = `/v1/orgs/${org.orgId}`;
  const menu = `${base}/branches/${branchId}/menu`;
  const qr = `${base}/branches/${branchId}/qr`;
  return { owner, admin, staff, org, branchId, base, menu, qr };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function setTableCount(branchId: string, tableCount: number) {
  await db().update(branches).set({ tableCount }).where(eq(branches.id, branchId));
}

/** Agrega un producto disponible y publica el menú. Devuelve el slug. */
async function publish({ menu, owner }: Setup) {
  const category = await callApi("POST", `${menu}/categories`, {
    cookie: owner.cookie,
    body: { name: "Tacos" },
  });
  expect(category.status).toBe(201);
  const { id: categoryId } = CategoryDto.parse(await category.json());
  const product = await callApi("POST", `${menu}/products`, {
    cookie: owner.cookie,
    body: { categoryId, name: "Taco al pastor", priceCents: 2_500 },
  });
  expect(product.status).toBe(201);
  const response = await callApi("POST", `${menu}/publish`, { cookie: owner.cookie });
  expect(response.status).toBe(200);
  const { slug } = MenuPublicationDto.parse(await response.json());
  expect(slug).not.toBeNull();
  return slug ?? "";
}

async function published() {
  const context = await setup();
  return { ...context, slug: await publish(context) };
}

/** Matriz de módulos (`true` = negro) reconstruida desde el `path` del SVG de `uqr`. */
function modulesOf(svg: string): boolean[][] {
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  const pixel = /M\d+,\d+h(\d+)v/.exec(svg);
  expect(viewBox).not.toBeNull();
  expect(pixel).not.toBeNull();
  const pixelSize = Number(pixel?.[1]);
  const size = Number(viewBox?.[1]) / pixelSize;
  expect(Number(viewBox?.[2]) / pixelSize).toBe(size);
  const matrix = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  for (const [, x, y] of svg.matchAll(/M(\d+),(\d+)h\d+v\d+h-\d+z/g)) {
    const row = matrix[Number(y) / pixelSize];
    if (row) row[Number(x) / pixelSize] = true;
  }
  return matrix;
}

/**
 * Nivel de corrección de errores leído de la información de formato junto al localizador de
 * arriba a la izquierda (ISO/IEC 18004): bits 14 y 13 en `(fila 8, columnas 0 y 1)`, después de
 * quitar la máscara `0x5412`. No depende de `uqr`.
 */
function eccLevel(matrix: boolean[][], border: number) {
  const bit = (col: number) => (matrix[border + 8]?.[border + col] ? 1 : 0);
  const value = ((bit(0) ^ 1) << 1) | bit(1);
  return (["M", "L", "H", "Q"] as const)[value];
}

async function expectQr(response: Response, url: string) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
  expect(response.headers.get("cache-control")).toBe("private, max-age=300");
  const svg = await response.text();

  // Mismo SVG que `uqr` produce para la URL esperada (ADR-017: nivel M, margen de 4).
  expect(svg).toBe(renderSVG(url, { ecc: "M", border: BORDER }));

  // Solo `svg`, `rect` y `path`: sin texto, scripts, manejadores ni referencias externas.
  const tags = new Set([...svg.matchAll(/<\s*([a-zA-Z][\w:-]*)/g)].map(([, tag]) => tag));
  expect(tags).toEqual(new Set(["svg", "rect", "path"]));
  expect(svg).not.toMatch(/<script/i);
  expect(svg).not.toMatch(/\son\w+\s*=/i);
  expect(svg).not.toMatch(/href|url\(|<image|<text|<foreignObject/i);

  // Margen blanco de 4 módulos por lado y nivel M en la información de formato.
  const matrix = modulesOf(svg);
  const size = matrix.length;
  const inBorder = (i: number) => i < BORDER || i >= size - BORDER;
  matrix.forEach((row, y) =>
    row.forEach((black, x) => {
      if (inBorder(x) || inBorder(y)) expect(black, `módulo ${x},${y}`).toBe(false);
    }),
  );
  expect((size - 2 * BORDER - 17) % 4).toBe(0);
  expect(eccLevel(matrix, BORDER)).toBe("M");
  return svg;
}

describe("GET /v1/orgs/:orgId/branches/:branchId/qr", () => {
  it("devuelve el QR del menú publicado con su URL de WEB", async () => {
    const { qr, owner, slug } = await published();
    await expectQr(await callApi("GET", qr, { cookie: owner.cookie }), `${WEB_ORIGIN}/m/${slug}`);
  });

  it.each(["owner", "admin", "staff"] as const)("%s descarga el QR de una mesa", async (role) => {
    const context = await published();
    const response = await callApi("GET", `${context.qr}?mesa=3`, {
      cookie: context[role].cookie,
    });
    await expectQr(response, `${WEB_ORIGIN}/m/${context.slug}?mesa=3`);
  });

  it("el QR de una mesa es distinto al del menú", async () => {
    const { qr, owner } = await published();
    const menu = await (await callApi("GET", qr, { cookie: owner.cookie })).text();
    const table = await (await callApi("GET", `${qr}?mesa=1`, { cookie: owner.cookie })).text();
    expect(table).not.toBe(menu);
  });

  it.each(["0", "4", "-1", "1.5", "abc", ""])("mesa=%s → 400", async (mesa) => {
    const { qr, owner } = await published();
    const response = await callApi("GET", `${qr}?mesa=${mesa}`, { cookie: owner.cookie });
    const body = await expectError(response, 400, "VALIDATION_FAILED");
    expect(body.fieldErrors?.mesa).toBeDefined();
  });

  it("mayor a `tableCount` dice qué mesas valen", async () => {
    const { qr, owner } = await published();
    const response = await callApi("GET", `${qr}?mesa=4`, { cookie: owner.cookie });
    const body = await expectError(response, 400, "VALIDATION_FAILED");
    expect(body.fieldErrors?.mesa).toEqual(["Elige una mesa de la 1 a la 3."]);
  });

  it("sin mesas, cualquier `mesa` → 400; el QR del menú sí sale", async () => {
    const context = await published();
    await setTableCount(context.branchId, 0);
    const cookie = context.owner.cookie;
    const response = await callApi("GET", `${context.qr}?mesa=1`, { cookie });
    const body = await expectError(response, 400, "VALIDATION_FAILED");
    expect(body.message).toBe(QR_NO_TABLES);
    await expectQr(await callApi("GET", context.qr, { cookie }), `${WEB_ORIGIN}/m/${context.slug}`);
  });

  it("llave desconocida en la query → 400", async () => {
    const { qr, owner } = await published();
    const response = await callApi("GET", `${qr}?table=1`, { cookie: owner.cookie });
    await expectError(response, 400, "VALIDATION_FAILED");
  });

  it("sucursal sin menú → 422", async () => {
    const { qr, owner } = await setup();
    const response = await callApi("GET", qr, { cookie: owner.cookie });
    const body = await expectError(response, 422, "BUSINESS_RULE");
    expect(body.message).toBe(QR_MENU_NOT_PUBLISHED);
  });

  it("menú en borrador → 422", async () => {
    const context = await setup();
    const response = await callApi("POST", `${context.menu}/categories`, {
      cookie: context.owner.cookie,
      body: { name: "Tacos" },
    });
    expect(response.status).toBe(201);
    const qr = await callApi("GET", `${context.qr}?mesa=1`, { cookie: context.owner.cookie });
    const body = await expectError(qr, 422, "BUSINESS_RULE");
    expect(body.message).toBe(QR_MENU_NOT_PUBLISHED);
  });

  it("menú despublicado → 422", async () => {
    const { qr, menu, owner } = await published();
    const unpublish = await callApi("POST", `${menu}/unpublish`, { cookie: owner.cookie });
    expect(unpublish.status).toBe(200);
    const response = await callApi("GET", qr, { cookie: owner.cookie });
    await expectError(response, 422, "BUSINESS_RULE");
  });

  it("sin sesión → 401", async () => {
    const { qr } = await published();
    await expectError(await callApi("GET", qr), 401, "AUTH_REQUIRED");
  });

  it("otra organización con ids reales → 404", async () => {
    const { qr, branchId } = await published();
    const intruder = await createUser();
    const other = await createOrg({ ownerId: intruder.id });
    await expectNotFoundForOtherTenant({
      intruder,
      paths: [qr, `/v1/orgs/${other.orgId}/branches/${branchId}/qr`],
    });
  });

  it("staff de otra sucursal → 404", async () => {
    const context = await published();
    const otherBranch = await createBranch({
      orgId: context.org.orgId,
      businessId: context.org.businessId,
      name: "Sucursal Norte",
    });
    const staff = await createUser();
    await addMember({
      orgId: context.org.orgId,
      userId: staff.id,
      role: "staff",
      branchIds: [otherBranch],
    });
    const response = await callApi("GET", context.qr, { cookie: staff.cookie });
    await expectError(response, 404, "NOT_FOUND");
  });
});
