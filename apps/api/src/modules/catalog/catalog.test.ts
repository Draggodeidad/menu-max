import {
  BranchDto,
  CategoryDto,
  DeliveryZoneDto,
  ErrorResponse,
  MAX_ABOVE_OPTIONS,
  MIN_ABOVE_MAX,
  OptionGroupInput,
  MediaAssetDto,
  MenuDto,
  ProductDto,
  ReorderResultDto,
  SubscriptionDto,
} from "@menu-max/contracts";
import {
  categories,
  menus,
  optionGroups,
  options,
  plans,
  products,
  productVariants,
} from "@menu-max/database";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  addMember,
  createBranch,
  createOrg,
  createUser,
  jpegBytes,
  pngBytes,
} from "../../../test/factories";
import { callApi, expectNotFoundForOtherTenant } from "../../../test/isolation";
import { getEnv, type Env } from "../../env";
import { createDb } from "../../infrastructure/db";
import { newId } from "../../shared/ids";
import { loadTenant } from "../organizations/organizations.service";
import { guardFailure, updateProduct as updateProductRow } from "./catalog.repository";
import { CATEGORY_IN_USE, IMAGE_NOT_FOUND, ORDER_CONFLICT } from "./catalog.service";

const db = () => createDb(getEnv(env));

/** Inserta filas directo en D1 en bloques de 5 (D1 admite 100 parámetros por sentencia). */
async function seed<T extends typeof categories | typeof products>(
  table: T,
  rows: T["$inferInsert"][],
) {
  const database = db();
  const statements = Array.from({ length: Math.ceil(rows.length / 5) }, (_, i) =>
    database.insert(table).values(rows.slice(i * 5, i * 5 + 5)),
  );
  const [first, ...rest] = statements;
  if (first) await database.batch([first, ...rest]);
}

async function expectError(response: Response, status: number, code: ErrorResponse["code"]) {
  expect(response.status).toBe(status);
  const body = ErrorResponse.parse(await response.json());
  expect(body.code).toBe(code);
  return body;
}

/** Organización con owner, una sucursal, un admin y un staff asignado a esa sucursal. */
async function setup(subscription: { planId?: string; status?: "suspended" } = {}) {
  const owner = await createUser();
  const org = await createOrg({ ownerId: owner.id, ...subscription });
  const branchId = await createBranch({ orgId: org.orgId, businessId: org.businessId });
  const admin = await createUser();
  await addMember({ orgId: org.orgId, userId: admin.id, role: "admin" });
  const staff = await createUser();
  await addMember({ orgId: org.orgId, userId: staff.id, role: "staff", branchIds: [branchId] });
  const menu = `/v1/orgs/${org.orgId}/branches/${branchId}/menu`;
  return { owner, admin, staff, org, branchId, menu };
}

async function readMenu(menu: string, cookie: string) {
  const response = await callApi("GET", menu, { cookie });
  expect(response.status).toBe(200);
  return MenuDto.parse(await response.json());
}

async function addCategory(menu: string, cookie: string, name = "Tacos") {
  const response = await callApi("POST", `${menu}/categories`, { cookie, body: { name } });
  expect(response.status).toBe(201);
  return CategoryDto.parse(await response.json());
}

const pastor = {
  name: "Taco al pastor",
  description: "Con piña y cilantro.",
  priceCents: 2_500,
  variants: [
    { name: "Sencillo", priceCents: 2_500 },
    { name: "Doble tortilla", priceCents: 3_000 },
  ],
  optionGroups: [
    {
      name: "Salsas",
      minSelect: 0,
      maxSelect: 2,
      options: [
        { name: "Verde", priceDeltaCents: 0 },
        { name: "Roja", priceDeltaCents: 0 },
        { name: "Habanero", priceDeltaCents: 500 },
      ],
    },
  ],
};

async function addProduct(menu: string, cookie: string, categoryId: string, body: object = {}) {
  const response = await callApi("POST", `${menu}/products`, {
    cookie,
    body: { ...pastor, categoryId, ...body },
  });
  expect(response.status).toBe(201);
  return ProductDto.parse(await response.json());
}

async function menuVersion(branchId: string) {
  const [row] = await db()
    .select({ menuVersion: menus.menuVersion })
    .from(menus)
    .where(eq(menus.branchId, branchId));
  return row?.menuVersion;
}

describe("GET /menu", () => {
  it("una sucursal anterior al catálogo obtiene su menú vacío en borrador", async () => {
    const { owner, branchId, menu } = await setup();
    const dto = await readMenu(menu, owner.cookie);
    expect(dto).toMatchObject({
      branchId,
      status: "draft",
      slug: null,
      publishedAt: null,
      menuVersion: 1,
      categories: [],
    });
    // La segunda lectura devuelve el mismo menú.
    expect((await readMenu(menu, owner.cookie)).id).toBe(dto.id);
  });

  it("una sucursal creada por la API ya trae su menú", async () => {
    const { owner, org } = await setup();
    const response = await callApi("POST", `/v1/orgs/${org.orgId}/branches`, {
      cookie: owner.cookie,
      body: { name: "Sucursal Norte", modes: { table: false, pickup: true, delivery: false } },
    });
    expect(response.status).toBe(201);
    const branch = BranchDto.parse(await response.json());
    const [row] = await db().select().from(menus).where(eq(menus.branchId, branch.id));
    expect(row).toMatchObject({ organizationId: org.orgId, status: "draft", menuVersion: 1 });
  });

  it("staff lee el menú de su sucursal; una no asignada → 404", async () => {
    const { staff, org, menu } = await setup();
    await readMenu(menu, staff.cookie);
    const other = await createBranch({ orgId: org.orgId, businessId: org.businessId });
    await expectError(
      await callApi("GET", `/v1/orgs/${org.orgId}/branches/${other}/menu`, {
        cookie: staff.cookie,
      }),
      404,
      "NOT_FOUND",
    );
  });

  it("con 20 categorías y 200 productos usa ≤ 4 consultas del catálogo", async () => {
    const { owner, org, menu } = await setup();
    const { id: menuId } = await readMenu(menu, owner.cookie);
    const database = db();
    const categoryIds = Array.from({ length: 20 }, () => newId());
    const productRows = categoryIds.flatMap((categoryId, c) =>
      Array.from({ length: 10 }, (_, p) => ({
        id: newId(),
        organizationId: org.orgId,
        menuId,
        categoryId,
        name: `Producto ${c}-${p}`,
        priceCents: 1_000 + p,
        position: p,
      })),
    );
    const firstProduct = productRows[0]?.id ?? "";
    const groupId = newId();
    await seed(
      categories,
      categoryIds.map((id, position) => ({
        id,
        organizationId: org.orgId,
        menuId,
        name: `Categoría ${position}`,
        position,
      })),
    );
    await seed(products, productRows);
    await database.batch([
      database.insert(productVariants).values([
        {
          id: newId(),
          organizationId: org.orgId,
          productId: firstProduct,
          name: "Chico",
          priceCents: 900,
          position: 0,
        },
        {
          id: newId(),
          organizationId: org.orgId,
          productId: firstProduct,
          name: "Grande",
          priceCents: 1_500,
          position: 1,
        },
      ]),
      database.insert(optionGroups).values({
        id: groupId,
        organizationId: org.orgId,
        productId: firstProduct,
        name: "Extras",
        minSelect: 0,
        maxSelect: 1,
        position: 0,
      }),
      database.insert(options).values({
        id: newId(),
        organizationId: org.orgId,
        optionGroupId: groupId,
        name: "Queso",
        priceDeltaCents: 1_000,
        position: 0,
      }),
    ]);

    const queries: string[] = [];
    const real = getEnv(env);
    const bindings: Env = {
      ...real,
      DB: new Proxy(real.DB, {
        get(target, property) {
          if (property === "prepare") {
            return (query: string) => {
              queries.push(query);
              return target.prepare(query);
            };
          }
          const value: unknown = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    };
    const response = await callApi("GET", menu, { cookie: owner.cookie, bindings });
    expect(response.status).toBe(200);
    const dto = MenuDto.parse(await response.json());

    expect(dto.categories).toHaveLength(20);
    expect(dto.categories.flatMap((category) => category.products)).toHaveLength(200);
    const first = dto.categories[0]?.products[0];
    expect(first?.variants.map((variant) => variant.name)).toEqual(["Chico", "Grande"]);
    expect(first?.optionGroups[0]?.options.map((option) => option.name)).toEqual(["Queso"]);

    // Las guardas de sesión, membresía y sucursal no leen tablas del catálogo.
    const catalogQueries = queries.filter((query) =>
      /"(menus|categories|products|product_variants|option_groups|options)"/.test(query),
    );
    expect(catalogQueries.length).toBeLessThanOrEqual(4);
  });
});

describe("categorías", () => {
  it("crea, renombra y borra (lógico) una categoría", async () => {
    const { admin, menu } = await setup();
    const tacos = await addCategory(menu, admin.cookie);
    const bebidas = await addCategory(menu, admin.cookie, "Bebidas");
    expect([tacos.position, bebidas.position]).toEqual([0, 1]);

    const renamed = await callApi("PATCH", `${menu}/categories/${tacos.id}`, {
      cookie: admin.cookie,
      body: { version: 1, name: "Tacos de la casa" },
    });
    expect(renamed.status).toBe(200);
    expect(CategoryDto.parse(await renamed.json())).toMatchObject({
      name: "Tacos de la casa",
      version: 2,
    });

    const deleted = await callApi("DELETE", `${menu}/categories/${bebidas.id}`, {
      cookie: admin.cookie,
    });
    expect(deleted.status).toBe(204);
    const dto = await readMenu(menu, admin.cookie);
    expect(dto.categories.map((category) => category.name)).toEqual(["Tacos de la casa"]);
    const [row] = await db().select().from(categories).where(eq(categories.id, bebidas.id));
    expect(row?.deletedAt).not.toBeNull();

    await expectError(
      await callApi("DELETE", `${menu}/categories/${bebidas.id}`, { cookie: admin.cookie }),
      404,
      "NOT_FOUND",
    );
  });

  it("PATCH con version vieja → 409", async () => {
    const { owner, menu } = await setup();
    const tacos = await addCategory(menu, owner.cookie);
    const path = `${menu}/categories/${tacos.id}`;
    expect(
      (await callApi("PATCH", path, { cookie: owner.cookie, body: { version: 1, name: "A" } }))
        .status,
    ).toBe(200);
    await expectError(
      await callApi("PATCH", path, { cookie: owner.cookie, body: { version: 1, name: "B" } }),
      409,
      "CONFLICT",
    );
  });

  it("borrar una categoría con productos (aunque estén agotados) → BUSINESS_RULE", async () => {
    const { owner, menu } = await setup();
    const tacos = await addCategory(menu, owner.cookie);
    const product = await addProduct(menu, owner.cookie, tacos.id, { available: false });
    const error = await expectError(
      await callApi("DELETE", `${menu}/categories/${tacos.id}`, { cookie: owner.cookie }),
      422,
      "BUSINESS_RULE",
    );
    expect(error.message).toBe(CATEGORY_IN_USE);

    await callApi("DELETE", `${menu}/products/${product.id}`, { cookie: owner.cookie });
    expect(
      (await callApi("DELETE", `${menu}/categories/${tacos.id}`, { cookie: owner.cookie })).status,
    ).toBe(204);
  });

  it("ordena las categorías; una lista incompleta o con ids ajenos → 409", async () => {
    const { owner, menu } = await setup();
    const a = await addCategory(menu, owner.cookie, "A");
    const b = await addCategory(menu, owner.cookie, "B");
    const c = await addCategory(menu, owner.cookie, "C");

    const response = await callApi("PUT", `${menu}/categories/order`, {
      cookie: owner.cookie,
      body: { ids: [c.id, a.id, b.id] },
    });
    expect(response.status).toBe(200);
    expect(ReorderResultDto.parse(await response.json()).items).toEqual([
      { id: c.id, position: 0, version: 2 },
      { id: a.id, position: 1, version: 2 },
      { id: b.id, position: 2, version: 2 },
    ]);
    const dto = await readMenu(menu, owner.cookie);
    expect(dto.categories.map((category) => category.name)).toEqual(["C", "A", "B"]);

    await Promise.all(
      [
        [c.id, a.id],
        [c.id, a.id, b.id, newId()],
      ].map(async (ids) => {
        const error = await expectError(
          await callApi("PUT", `${menu}/categories/order`, { cookie: owner.cookie, body: { ids } }),
          409,
          "CONFLICT",
        );
        expect(error.message).toBe(ORDER_CONFLICT);
      }),
    );
    await expectError(
      await callApi("PUT", `${menu}/categories/order`, {
        cookie: owner.cookie,
        body: { ids: [a.id, a.id, b.id] },
      }),
      400,
      "VALIDATION_FAILED",
    );
  });
});

describe("productos", () => {
  it("crea un producto con variantes y opciones, lo edita y lo borra (lógico)", async () => {
    const { admin, menu } = await setup();
    const tacos = await addCategory(menu, admin.cookie);
    const product = await addProduct(menu, admin.cookie, tacos.id);
    expect(product).toMatchObject({
      categoryId: tacos.id,
      name: "Taco al pastor",
      description: "Con piña y cilantro.",
      priceCents: 2_500,
      available: true,
      position: 0,
      version: 1,
    });
    expect(product.variants.map((v) => [v.name, v.priceCents, v.position])).toEqual([
      ["Sencillo", 2_500, 0],
      ["Doble tortilla", 3_000, 1],
    ]);
    expect(product.optionGroups[0]).toMatchObject({ name: "Salsas", minSelect: 0, maxSelect: 2 });
    expect(product.optionGroups[0]?.options.map((o) => o.name)).toEqual([
      "Verde",
      "Roja",
      "Habanero",
    ]);

    // Variantes reemplazadas; grupos omitidos se conservan; descripción vacía = sin descripción.
    const response = await callApi("PATCH", `${menu}/products/${product.id}`, {
      cookie: admin.cookie,
      body: {
        version: 1,
        priceCents: 2_800,
        description: "",
        variants: [{ name: "Orden de 3", priceCents: 7_000 }],
      },
    });
    expect(response.status).toBe(200);
    const updated = ProductDto.parse(await response.json());
    expect(updated).toMatchObject({ priceCents: 2_800, description: null, version: 2 });
    expect(updated.variants.map((v) => v.name)).toEqual(["Orden de 3"]);
    expect(updated.optionGroups).toEqual(product.optionGroups);
    const variantRows = await db()
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, product.id));
    expect(variantRows).toHaveLength(1);

    // `optionGroups: []` quita todos los grupos y sus opciones.
    const cleared = await callApi("PATCH", `${menu}/products/${product.id}`, {
      cookie: admin.cookie,
      body: { version: 2, optionGroups: [] },
    });
    expect(ProductDto.parse(await cleared.json()).optionGroups).toEqual([]);
    const groupId = product.optionGroups[0]?.id ?? "";
    expect(await db().select().from(options).where(eq(options.optionGroupId, groupId))).toEqual([]);

    const deleted = await callApi("DELETE", `${menu}/products/${product.id}`, {
      cookie: admin.cookie,
    });
    expect(deleted.status).toBe(204);
    const dto = await readMenu(menu, admin.cookie);
    expect(dto.categories[0]?.products).toEqual([]);
    const [row] = await db().select().from(products).where(eq(products.id, product.id));
    expect(row?.deletedAt).not.toBeNull();

    await Promise.all(
      (
        [
          ["PATCH", `${menu}/products/${product.id}`, { version: 3, name: "Otro" }],
          [
            "PATCH",
            `${menu}/products/${product.id}/availability`,
            { version: 3, available: false },
          ],
          ["DELETE", `${menu}/products/${product.id}`, undefined],
        ] as const
      ).map(async ([method, path, body]) => {
        await expectError(
          await callApi(method, path, { cookie: admin.cookie, body }),
          404,
          "NOT_FOUND",
        );
      }),
    );
  });

  it("el menú incluye productos no disponibles", async () => {
    const { owner, menu } = await setup();
    const tacos = await addCategory(menu, owner.cookie);
    await addProduct(menu, owner.cookie, tacos.id, { available: false });
    const dto = await readMenu(menu, owner.cookie);
    expect(dto.categories[0]?.products.map((p) => p.available)).toEqual([false]);
  });

  it("PATCH y disponibilidad con version vieja → 409", async () => {
    const { owner, menu } = await setup();
    const tacos = await addCategory(menu, owner.cookie);
    const product = await addProduct(menu, owner.cookie, tacos.id);
    const path = `${menu}/products/${product.id}`;
    expect(
      (await callApi("PATCH", path, { cookie: owner.cookie, body: { version: 1, name: "A" } }))
        .status,
    ).toBe(200);
    await expectError(
      await callApi("PATCH", path, { cookie: owner.cookie, body: { version: 1, name: "B" } }),
      409,
      "CONFLICT",
    );
    await expectError(
      await callApi("PATCH", `${path}/availability`, {
        cookie: owner.cookie,
        body: { version: 1, available: false },
      }),
      409,
      "CONFLICT",
    );
  });

  it("si la version cambia entre la lectura y el batch, la guarda revierte todo", async () => {
    const { owner, org, branchId, menu } = await setup();
    const tacos = await addCategory(menu, owner.cookie);
    const product = await addProduct(menu, owner.cookie, tacos.id);
    const before = await menuVersion(branchId);
    const tenant = await loadTenant(db(), org.orgId, owner.id, "prueba");
    if (!tenant) throw new Error("sin tenant");
    const { id: menuId } = await readMenu(menu, owner.cookie);

    const error = await updateProductRow(db(), tenant, menuId, product.id, 99, {
      changes: { name: "Pisado" },
      variants: [{ id: newId(), productId: product.id, name: "Nueva", priceCents: 1, position: 0 }],
    }).catch((caught: unknown) => caught);
    expect(guardFailure(error)).toBe("version");

    const dto = await readMenu(menu, owner.cookie);
    expect(dto.categories[0]?.products[0]).toEqual(product);
    expect(await menuVersion(branchId)).toBe(before);
  });

  it("mover de categoría lo pone al final de la nueva; una categoría inexistente → 404", async () => {
    const { owner, menu } = await setup();
    const tacos = await addCategory(menu, owner.cookie);
    const bebidas = await addCategory(menu, owner.cookie, "Bebidas");
    await addProduct(menu, owner.cookie, bebidas.id, { name: "Horchata" });
    const product = await addProduct(menu, owner.cookie, tacos.id);

    const moved = await callApi("PATCH", `${menu}/products/${product.id}`, {
      cookie: owner.cookie,
      body: { version: 1, categoryId: bebidas.id },
    });
    expect(ProductDto.parse(await moved.json())).toMatchObject({
      categoryId: bebidas.id,
      position: 1,
    });

    const error = await expectError(
      await callApi("PATCH", `${menu}/products/${product.id}`, {
        cookie: owner.cookie,
        body: { version: 2, categoryId: newId() },
      }),
      404,
      "NOT_FOUND",
    );
    expect(error.fieldErrors?.categoryId).toBeDefined();
    await expectError(
      await callApi("POST", `${menu}/products`, {
        cookie: owner.cookie,
        body: { ...pastor, categoryId: newId() },
      }),
      404,
      "NOT_FOUND",
    );
  });

  it("ordena los productos de una categoría", async () => {
    const { owner, menu } = await setup();
    const tacos = await addCategory(menu, owner.cookie);
    const a = await addProduct(menu, owner.cookie, tacos.id, { name: "A" });
    const b = await addProduct(menu, owner.cookie, tacos.id, { name: "B" });
    const path = `${menu}/categories/${tacos.id}/products/order`;

    const response = await callApi("PUT", path, {
      cookie: owner.cookie,
      body: { ids: [b.id, a.id] },
    });
    expect(response.status).toBe(200);
    expect(ReorderResultDto.parse(await response.json()).items.map((item) => item.id)).toEqual([
      b.id,
      a.id,
    ]);
    const dto = await readMenu(menu, owner.cookie);
    expect(dto.categories[0]?.products.map((p) => p.name)).toEqual(["B", "A"]);

    await expectError(
      await callApi("PUT", path, { cookie: owner.cookie, body: { ids: [b.id] } }),
      409,
      "CONFLICT",
    );
  });

  it("min_select > max_select, máximo mayor que las opciones, precio negativo o con decimales → 400", async () => {
    const { owner, menu } = await setup();
    const tacos = await addCategory(menu, owner.cookie);
    const group = pastor.optionGroups[0];
    // La API no repite los mensajes de Zod (pueden incluir lo enviado): basta el campo.
    const cases: [object, string][] = [
      [{ optionGroups: [{ ...group, minSelect: 3, maxSelect: 2 }] }, "optionGroups"],
      [{ optionGroups: [{ ...group, minSelect: 0, maxSelect: 4 }] }, "optionGroups"],
      [{ priceCents: -1 }, "priceCents"],
      [{ priceCents: 12.5 }, "priceCents"],
      [{ variants: [{ name: "Chico", priceCents: -100 }] }, "variants"],
      [
        { optionGroups: [{ ...group, options: [{ name: "Queso", priceDeltaCents: -500 }] }] },
        "optionGroups",
      ],
    ];
    await Promise.all(
      cases.map(async ([body, field]) => {
        const error = await expectError(
          await callApi("POST", `${menu}/products`, {
            cookie: owner.cookie,
            body: { ...pastor, categoryId: tacos.id, ...body },
          }),
          400,
          "VALIDATION_FAILED",
        );
        expect(Object.keys(error.fieldErrors ?? {})).toEqual([field]);
      }),
    );
    expect((await readMenu(menu, owner.cookie)).categories[0]?.products).toEqual([]);
  });

  it("el contrato explica qué corregir en un grupo de opciones (para el formulario)", () => {
    const group = pastor.optionGroups[0];
    const messages = (input: object) =>
      OptionGroupInput.safeParse({ ...group, ...input }).error?.issues.map((i) => i.message);
    expect(messages({ minSelect: 3, maxSelect: 2 })).toContain(MIN_ABOVE_MAX);
    expect(messages({ maxSelect: 4 })).toContain(MAX_ABOVE_OPTIONS);
  });

  it("el producto 51 en plan free → 402, y el uso de la suscripción lo cuenta", async () => {
    const { owner, org, menu } = await setup({ planId: "free" });
    const [free] = await db().select().from(plans).where(eq(plans.id, "free"));
    const limit = free?.maxProducts ?? 0;
    const tacos = await addCategory(menu, owner.cookie);
    const { id: menuId } = await readMenu(menu, owner.cookie);
    const rows = Array.from({ length: limit }, (_, position) => ({
      id: newId(),
      organizationId: org.orgId,
      menuId,
      categoryId: tacos.id,
      name: `Producto ${position}`,
      priceCents: 1_000,
      position,
    }));
    await seed(products, rows);

    await expectError(
      await callApi("POST", `${menu}/products`, {
        cookie: owner.cookie,
        body: { ...pastor, categoryId: tacos.id },
      }),
      402,
      "PLAN_LIMIT_REACHED",
    );
    const subscription = await callApi("GET", `/v1/orgs/${org.orgId}/subscription`, {
      cookie: owner.cookie,
    });
    expect(SubscriptionDto.parse(await subscription.json()).usage.products).toBe(limit);

    // Un producto borrado libera su lugar.
    await callApi("DELETE", `${menu}/products/${rows[0]?.id ?? ""}`, { cookie: owner.cookie });
    await addProduct(menu, owner.cookie, tacos.id);
  });
});

describe("menu_version", () => {
  it("cada mutación del catálogo (y de zonas) sube menu_version exactamente en 1", async () => {
    const { owner, staff, branchId, menu } = await setup();
    await readMenu(menu, owner.cookie);
    let expected = 1;
    const step = async (
      method: string,
      path: string,
      body: unknown,
      cookie = owner.cookie,
    ): Promise<unknown> => {
      const response = await callApi(method, path, { cookie, body });
      expect(response.status, `${method} ${path}`).toBeLessThan(300);
      expected += 1;
      expect(await menuVersion(branchId), `${method} ${path}`).toBe(expected);
      return response.status === 204 ? undefined : response.json();
    };

    const tacos = CategoryDto.parse(await step("POST", `${menu}/categories`, { name: "Tacos" }));
    const otra = CategoryDto.parse(await step("POST", `${menu}/categories`, { name: "Otra" }));
    await step("PATCH", `${menu}/categories/${tacos.id}`, { version: 1, name: "Tacos!" });
    await step("PUT", `${menu}/categories/order`, { ids: [otra.id, tacos.id] });
    const product = ProductDto.parse(
      await step("POST", `${menu}/products`, { ...pastor, categoryId: tacos.id }),
    );
    await step("PATCH", `${menu}/products/${product.id}`, { version: 1, priceCents: 1 });
    await step(
      "PATCH",
      `${menu}/products/${product.id}/availability`,
      { version: 2, available: false },
      staff.cookie,
    );
    await step("PUT", `${menu}/categories/${tacos.id}/products/order`, { ids: [product.id] });
    await step("DELETE", `${menu}/products/${product.id}`, undefined);
    await step("DELETE", `${menu}/categories/${otra.id}`, undefined);

    // Zonas de entrega (ADR-018): cambian el menú público.
    const zones = menu.replace(/\/menu$/, "/zones");
    const zone = DeliveryZoneDto.parse(
      await step("POST", zones, { name: "Centro", postalCodes: ["06700"], feeCents: 3_000 }),
    );
    await step("PATCH", `${zones}/${zone.id}`, { version: 1, active: false });
    await step("DELETE", `${zones}/${zone.id}`, undefined);

    // Errores y lecturas no la mueven.
    await callApi("PATCH", `${menu}/categories/${tacos.id}`, {
      cookie: owner.cookie,
      body: { version: 1, name: "Vieja" },
    });
    await callApi("DELETE", `${menu}/products/${product.id}`, { cookie: owner.cookie });
    await readMenu(menu, owner.cookie);
    expect(await menuVersion(branchId)).toBe(expected);
    expect((await readMenu(menu, owner.cookie)).menuVersion).toBe(expected);
  });
});

async function uploadImage(orgId: string, cookie: string, bytes = jpegBytes(1200, 800)) {
  const response = await callApi("POST", `/v1/orgs/${orgId}/media`, {
    cookie,
    rawBody: bytes,
    headers: { "content-type": "image/jpeg" },
  });
  expect(response.status).toBe(201);
  return MediaAssetDto.parse(await response.json());
}

describe("imagen del producto (T17)", () => {
  it("PATCH liga la imagen: el DTO y GET /menu traen URL y dimensiones; null la quita", async () => {
    const { owner, org, branchId, menu } = await setup();
    const tacos = await addCategory(menu, owner.cookie);
    const product = await addProduct(menu, owner.cookie, tacos.id);
    expect(product).toMatchObject({ imageUrl: null, imageWidth: null, imageHeight: null });
    const asset = await uploadImage(org.orgId, owner.cookie);

    const before = await menuVersion(branchId);
    const patched = await callApi("PATCH", `${menu}/products/${product.id}`, {
      cookie: owner.cookie,
      body: { version: 1, imageAssetId: asset.id },
    });
    expect(patched.status).toBe(200);
    expect(ProductDto.parse(await patched.json())).toMatchObject({
      version: 2,
      imageUrl: asset.url,
      imageWidth: 1200,
      imageHeight: 800,
    });
    expect(await menuVersion(branchId)).toBe((before ?? 0) + 1);

    const listed = (await readMenu(menu, owner.cookie)).categories[0]?.products[0];
    expect(listed).toMatchObject({ imageUrl: asset.url, imageWidth: 1200, imageHeight: 800 });

    // Otra imagen la reemplaza; `null` la quita. Ambos suben `menu_version`.
    const other = await uploadImage(org.orgId, owner.cookie, pngBytes(500, 500));
    const replaced = await callApi("PATCH", `${menu}/products/${product.id}`, {
      cookie: owner.cookie,
      body: { version: 2, imageAssetId: other.id },
    });
    expect(ProductDto.parse(await replaced.json())).toMatchObject({
      imageUrl: other.url,
      imageWidth: 500,
    });
    const removed = await callApi("PATCH", `${menu}/products/${product.id}`, {
      cookie: owner.cookie,
      body: { version: 3, imageAssetId: null },
    });
    expect(ProductDto.parse(await removed.json())).toMatchObject({
      imageUrl: null,
      imageWidth: null,
      imageHeight: null,
    });
    expect(await menuVersion(branchId)).toBe((before ?? 0) + 3);

    // Un PATCH sin `imageAssetId` no la toca.
    await callApi("PATCH", `${menu}/products/${product.id}`, {
      cookie: owner.cookie,
      body: { version: 4, imageAssetId: asset.id },
    });
    const renamed = await callApi("PATCH", `${menu}/products/${product.id}`, {
      cookie: owner.cookie,
      body: { version: 5, name: "Taco de suadero" },
    });
    expect(ProductDto.parse(await renamed.json()).imageUrl).toBe(asset.url);
  });

  it("imageAssetId de otra organización → 404 sin cambiar el producto", async () => {
    const { owner, menu, branchId } = await setup();
    const tacos = await addCategory(menu, owner.cookie);
    const product = await addProduct(menu, owner.cookie, tacos.id);
    const other = await setup();
    const foreign = await uploadImage(other.org.orgId, other.owner.cookie);

    const before = await menuVersion(branchId);
    const error = await expectError(
      await callApi("PATCH", `${menu}/products/${product.id}`, {
        cookie: owner.cookie,
        body: { version: 1, imageAssetId: foreign.id },
      }),
      404,
      "NOT_FOUND",
    );
    expect(error.message).toBe(IMAGE_NOT_FOUND);
    expect(error.fieldErrors).toEqual({ imageAssetId: [IMAGE_NOT_FOUND] });
    expect(await menuVersion(branchId)).toBe(before);
    const [row] = await db().select().from(products).where(eq(products.id, product.id));
    expect(row).toMatchObject({ version: 1, imageAssetId: null });
  });

  it("una imagen borrada → 404", async () => {
    const { owner, org, menu } = await setup();
    const tacos = await addCategory(menu, owner.cookie);
    const product = await addProduct(menu, owner.cookie, tacos.id);
    const asset = await uploadImage(org.orgId, owner.cookie);
    await callApi("DELETE", `/v1/orgs/${org.orgId}/media/${asset.id}`, { cookie: owner.cookie });
    await expectError(
      await callApi("PATCH", `${menu}/products/${product.id}`, {
        cookie: owner.cookie,
        body: { version: 1, imageAssetId: asset.id },
      }),
      404,
      "NOT_FOUND",
    );
  });

  it("la guarda del batch aborta si la imagen se borró después de validarla", async () => {
    const { owner, org, menu } = await setup();
    const tacos = await addCategory(menu, owner.cookie);
    const product = await addProduct(menu, owner.cookie, tacos.id);
    const asset = await uploadImage(org.orgId, owner.cookie);
    await callApi("DELETE", `/v1/orgs/${org.orgId}/media/${asset.id}`, { cookie: owner.cookie });

    const tenant = await loadTenant(db(), org.orgId, owner.id, "test");
    if (!tenant) throw new Error("sin tenant");
    const [menuRow] = await db().select().from(menus).where(eq(menus.organizationId, org.orgId));
    const failure = await updateProductRow(db(), tenant, menuRow?.id ?? "", product.id, 1, {
      changes: { imageAssetId: asset.id },
    }).then(
      () => undefined,
      (error: unknown) => guardFailure(error),
    );
    expect(failure).toBe("asset_missing");
    const [row] = await db().select().from(products).where(eq(products.id, product.id));
    expect(row?.imageAssetId).toBeNull();
  });

  it("imageAssetId mal formado → 400", async () => {
    const { owner, menu } = await setup();
    const tacos = await addCategory(menu, owner.cookie);
    const product = await addProduct(menu, owner.cookie, tacos.id);
    await expectError(
      await callApi("PATCH", `${menu}/products/${product.id}`, {
        cookie: owner.cookie,
        body: { version: 1, imageAssetId: "foto.jpg" },
      }),
      400,
      "VALIDATION_FAILED",
    );
  });
});

describe("permisos", () => {
  it("staff cambia la disponibilidad pero no el precio ni el catálogo (403); admin sí", async () => {
    const { owner, admin, staff, menu } = await setup();
    const tacos = await addCategory(menu, owner.cookie);
    const product = await addProduct(menu, owner.cookie, tacos.id);

    const available = await callApi("PATCH", `${menu}/products/${product.id}/availability`, {
      cookie: staff.cookie,
      body: { version: 1, available: false },
    });
    expect(available.status).toBe(200);
    expect(ProductDto.parse(await available.json())).toMatchObject({
      available: false,
      version: 2,
    });

    const forbidden: [string, string, unknown?][] = [
      ["PATCH", `${menu}/products/${product.id}`, { version: 2, priceCents: 1 }],
      ["POST", `${menu}/products`, { ...pastor, categoryId: tacos.id }],
      ["DELETE", `${menu}/products/${product.id}`],
      ["POST", `${menu}/categories`, { name: "Bebidas" }],
      ["PATCH", `${menu}/categories/${tacos.id}`, { version: 1, name: "Otra" }],
      ["DELETE", `${menu}/categories/${tacos.id}`],
      ["PUT", `${menu}/categories/order`, { ids: [tacos.id] }],
      ["PUT", `${menu}/categories/${tacos.id}/products/order`, { ids: [product.id] }],
    ];
    await Promise.all(
      forbidden.map(async ([method, path, body]) => {
        await expectError(
          await callApi(method, path, { cookie: staff.cookie, body }),
          403,
          "FORBIDDEN",
        );
      }),
    );

    const priced = await callApi("PATCH", `${menu}/products/${product.id}`, {
      cookie: admin.cookie,
      body: { version: 2, priceCents: 1 },
    });
    expect(priced.status).toBe(200);
  });

  it("staff no cambia la disponibilidad en una sucursal que no tiene asignada (404)", async () => {
    const { owner, staff, org } = await setup();
    const other = await createBranch({ orgId: org.orgId, businessId: org.businessId });
    const menu = `/v1/orgs/${org.orgId}/branches/${other}/menu`;
    const tacos = await addCategory(menu, owner.cookie);
    const product = await addProduct(menu, owner.cookie, tacos.id);
    await expectError(
      await callApi("PATCH", `${menu}/products/${product.id}/availability`, {
        cookie: staff.cookie,
        body: { version: 1, available: false },
      }),
      404,
      "NOT_FOUND",
    );
  });

  it("un producto o categoría de otra sucursal de la misma organización → 404", async () => {
    const { owner, org, menu } = await setup();
    const tacos = await addCategory(menu, owner.cookie);
    const product = await addProduct(menu, owner.cookie, tacos.id);
    const other = await createBranch({ orgId: org.orgId, businessId: org.businessId });
    const otherMenu = `/v1/orgs/${org.orgId}/branches/${other}/menu`;
    await Promise.all(
      (
        [
          ["PATCH", `${otherMenu}/products/${product.id}`, { version: 1, name: "X" }],
          ["PATCH", `${otherMenu}/categories/${tacos.id}`, { version: 1, name: "X" }],
          ["DELETE", `${otherMenu}/categories/${tacos.id}`, undefined],
          ["POST", `${otherMenu}/products`, { ...pastor, categoryId: tacos.id }],
        ] as const
      ).map(async ([method, path, body]) => {
        await expectError(
          await callApi(method, path, { cookie: owner.cookie, body }),
          404,
          "NOT_FOUND",
        );
      }),
    );
  });

  it("suscripción suspendida: lee el menú pero no lo cambia (403)", async () => {
    const { owner, menu } = await setup({ status: "suspended" });
    await readMenu(menu, owner.cookie);
    await expectError(
      await callApi("POST", `${menu}/categories`, { cookie: owner.cookie, body: { name: "A" } }),
      403,
      "FORBIDDEN",
    );
  });

  it("sin sesión → 401 en todas las rutas", async () => {
    const { owner, menu } = await setup();
    const tacos = await addCategory(menu, owner.cookie);
    const product = await addProduct(menu, owner.cookie, tacos.id);
    const routes: [string, string, unknown?][] = [
      ["GET", menu],
      ["POST", `${menu}/categories`, { name: "A" }],
      ["PUT", `${menu}/categories/order`, { ids: [tacos.id] }],
      ["PATCH", `${menu}/categories/${tacos.id}`, { version: 1, name: "A" }],
      ["DELETE", `${menu}/categories/${tacos.id}`],
      ["PUT", `${menu}/categories/${tacos.id}/products/order`, { ids: [product.id] }],
      ["POST", `${menu}/products`, { ...pastor, categoryId: tacos.id }],
      ["PATCH", `${menu}/products/${product.id}`, { version: 1 }],
      ["DELETE", `${menu}/products/${product.id}`],
      ["PATCH", `${menu}/products/${product.id}/availability`, { version: 1, available: true }],
    ];
    await Promise.all(
      routes.map(async ([method, path, body]) => {
        await expectError(await callApi(method, path, { body }), 401, "AUTH_REQUIRED");
      }),
    );
  });

  it("otra organización → 404 por las dos vías en todas las rutas", async () => {
    const { owner, org, branchId, menu } = await setup();
    const tacos = await addCategory(menu, owner.cookie);
    const product = await addProduct(menu, owner.cookie, tacos.id);
    const intruder = await createUser();
    const other = await createOrg({ ownerId: intruder.id });
    await createBranch({ orgId: other.orgId, businessId: other.businessId });

    const via = (suffix: string) => [
      `/v1/orgs/${org.orgId}/branches/${branchId}/menu${suffix}`,
      `/v1/orgs/${other.orgId}/branches/${branchId}/menu${suffix}`,
    ];
    const cases: [string, string, unknown?][] = [
      ["GET", ""],
      ["POST", "/categories", { name: "A" }],
      ["PUT", "/categories/order", { ids: [tacos.id] }],
      ["PATCH", `/categories/${tacos.id}`, { version: 1, name: "A" }],
      ["DELETE", `/categories/${tacos.id}`],
      ["PUT", `/categories/${tacos.id}/products/order`, { ids: [product.id] }],
      ["POST", "/products", { ...pastor, categoryId: tacos.id }],
      ["PATCH", `/products/${product.id}`, { version: 1, name: "A" }],
      ["DELETE", `/products/${product.id}`],
      ["PATCH", `/products/${product.id}/availability`, { version: 1, available: false }],
    ];
    await Promise.all(
      cases.map(async ([method, suffix, body]) => {
        await expectNotFoundForOtherTenant({ method, paths: via(suffix), body, intruder });
      }),
    );

    // Nada cambió en la organización A.
    const dto = await readMenu(menu, owner.cookie);
    expect(dto.categories.map((category) => category.name)).toEqual(["Tacos"]);
    expect(dto.categories[0]?.products[0]).toEqual(product);
  });
});
