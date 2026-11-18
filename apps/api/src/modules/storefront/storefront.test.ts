import {
  BranchDto,
  CategoryDto,
  ErrorResponse,
  MediaAssetDto,
  MenuPublicationDto,
  ProductDto,
  PublicMenuDto,
  PublicMenuVersionDto,
  SLUG_RESERVED_MESSAGE,
  THEME_PRESET_COLORS,
  ThemeDto,
  UNVERIFIED_GRACE_DAYS,
  UpdateSlugInput,
} from "@menu-max/contracts";
import {
  businesses,
  menus,
  organizations,
  storefrontThemes,
  subscriptions,
  users,
} from "@menu-max/database";
import { createEmailVerificationToken } from "better-auth/api";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addMember, createBranch, createOrg, createUser, pngBytes } from "../../../test/factories";
import { callApi, expectNotFoundForOtherTenant } from "../../../test/isolation";
import { getEnv, type Env } from "../../env";
import { createDb } from "../../infrastructure/db";
import { IMAGE_IN_USE } from "../catalog/media.service";
import { NO_AVAILABLE_PRODUCTS, SLUG_LOCKED, SLUG_TAKEN } from "./storefront.service";

const db = () => createDb(getEnv(env));
const DAY_MS = 24 * 60 * 60 * 1000;

async function expectError(response: Response, status: number, code: ErrorResponse["code"]) {
  expect(response.status).toBe(status);
  const body = ErrorResponse.parse(await response.json());
  expect(body.code).toBe(code);
  return body;
}

/** Nombre de negocio único por prueba: el slug es global y la D1 se comparte en el archivo. */
function uniqueName(prefix = "Tacos") {
  return `${prefix} ${crypto.randomUUID().slice(0, 8)}`;
}

async function renameBusiness(businessId: string, name: string) {
  await db().update(businesses).set({ name }).where(eq(businesses.id, businessId));
}

/** Organización con owner, una sucursal, un admin y un staff asignado a esa sucursal. */
async function setup(
  options: {
    planId?: string;
    status?: "suspended";
    ownerVerified?: boolean;
    businessName?: string;
  } = {},
) {
  const owner = await createUser({ emailVerified: options.ownerVerified ?? true });
  const org = await createOrg({
    ownerId: owner.id,
    planId: options.planId,
    status: options.status,
  });
  await renameBusiness(org.businessId, options.businessName ?? uniqueName());
  const branchId = await createBranch({ orgId: org.orgId, businessId: org.businessId });
  const admin = await createUser();
  await addMember({ orgId: org.orgId, userId: admin.id, role: "admin" });
  const staff = await createUser();
  await addMember({ orgId: org.orgId, userId: staff.id, role: "staff", branchIds: [branchId] });
  const base = `/v1/orgs/${org.orgId}`;
  const menu = `${base}/branches/${branchId}/menu`;
  return { owner, admin, staff, org, branchId, base, menu };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function readTheme(menu: string, cookie: string) {
  const response = await callApi("GET", `${menu}/theme`, { cookie });
  expect(response.status).toBe(200);
  return ThemeDto.parse(await response.json());
}

function putTheme(menu: string, cookie: string, body: object) {
  return callApi("PUT", `${menu}/theme`, { cookie, body });
}

async function savedTheme(menu: string, cookie: string, body: object) {
  const response = await putTheme(menu, cookie, body);
  expect(response.status).toBe(200);
  return ThemeDto.parse(await response.json());
}

async function addProduct(menu: string, cookie: string, body: object = {}) {
  const category = await callApi("POST", `${menu}/categories`, {
    cookie,
    body: { name: "Tacos" },
  });
  expect(category.status).toBe(201);
  const { id: categoryId } = CategoryDto.parse(await category.json());
  const product = await callApi("POST", `${menu}/products`, {
    cookie,
    body: {
      categoryId,
      name: "Taco al pastor",
      priceCents: 2_500,
      variants: [{ name: "Doble tortilla", priceCents: 3_000 }],
      optionGroups: [
        {
          name: "Salsas",
          minSelect: 0,
          maxSelect: 1,
          options: [{ name: "Verde", priceDeltaCents: 0 }],
        },
      ],
      ...body,
    },
  });
  expect(product.status).toBe(201);
  return { categoryId, product: ProductDto.parse(await product.json()) };
}

async function publish(menu: string, cookie: string) {
  const response = await callApi("POST", `${menu}/publish`, { cookie });
  expect(response.status).toBe(200);
  return MenuPublicationDto.parse(await response.json());
}

/** Sucursal publicada con un producto, abierta todo el día de cualquier día. */
async function published(options: Parameters<typeof setup>[0] = {}) {
  const context = await setup(options);
  await addProduct(context.menu, context.owner.cookie);
  await alwaysOpen(context);
  const publication = await publish(context.menu, context.owner.cookie);
  return { ...context, slug: publication.slug ?? "" };
}

async function alwaysOpen({ base, branchId, owner }: Setup) {
  const ranges = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    opensAt: "00:00",
    closesAt: "24:00",
  }));
  const response = await callApi("PUT", `${base}/branches/${branchId}/hours`, {
    cookie: owner.cookie,
    body: { ranges },
  });
  expect(response.status).toBe(200);
}

function readPublic(slug: string, bindings?: Env) {
  return callApi("GET", `/v1/public/menus/${slug}`, { bindings });
}

async function publicMenu(slug: string) {
  const response = await readPublic(slug);
  expect(response.status).toBe(200);
  return PublicMenuDto.parse(await response.json());
}

async function menuRow(branchId: string) {
  const [row] = await db().select().from(menus).where(eq(menus.branchId, branchId));
  return row;
}

async function upload(base: string, cookie: string) {
  const response = await callApi("POST", `${base}/media`, {
    cookie,
    rawBody: pngBytes(400, 400),
    headers: { "content-type": "image/png" },
  });
  expect(response.status).toBe(201);
  return MediaAssetDto.parse(await response.json());
}

// Guardas y aislamiento ---------------------------------------------------------------------

describe("guardas de las rutas del panel", () => {
  const routes = [
    ["GET", "/theme", undefined],
    ["PUT", "/theme", { preset: "dark" }],
    ["PATCH", "/slug", { slug: "tacos-nuevos" }],
    ["POST", "/publish", undefined],
    ["POST", "/unpublish", undefined],
  ] as const;

  it.each(routes)("%s %s sin sesión → 401", async (method, path, body) => {
    const { menu } = await setup();
    await expectError(await callApi(method, `${menu}${path}`, { body }), 401, "AUTH_REQUIRED");
  });

  it.each(routes)("%s %s desde otra organización → 404", async (method, path, body) => {
    const { org, branchId, menu } = await setup();
    const intruder = await createUser();
    const other = await createOrg({ ownerId: intruder.id });
    await expectNotFoundForOtherTenant({
      method,
      body,
      intruder,
      paths: [menu, `/v1/orgs/${other.orgId}/branches/${branchId}/menu`].map(
        (prefix) => `${prefix}${path}`,
      ),
    });
    expect(org.orgId).not.toBe(other.orgId);
  });

  it.each(routes.filter(([method]) => method !== "GET"))(
    "%s %s como staff → 403",
    async (method, path, body) => {
      const { staff, menu } = await setup();
      await expectError(
        await callApi(method, `${menu}${path}`, { cookie: staff.cookie, body }),
        403,
        "FORBIDDEN",
      );
    },
  );

  it("staff lee el tema de su sucursal, pero no el de otra (404)", async () => {
    const { staff, org, menu } = await setup();
    await readTheme(menu, staff.cookie);
    const otherBranch = await createBranch({ orgId: org.orgId, businessId: org.businessId });
    const response = await callApi(
      "GET",
      `/v1/orgs/${org.orgId}/branches/${otherBranch}/menu/theme`,
      {
        cookie: staff.cookie,
      },
    );
    await expectError(response, 404, "NOT_FOUND");
  });

  it("con la suscripción suspendida solo se lee", async () => {
    const { owner, menu } = await setup({ status: "suspended" });
    await readTheme(menu, owner.cookie);
    await expectError(await putTheme(menu, owner.cookie, { preset: "dark" }), 403, "FORBIDDEN");
    await expectError(
      await callApi("POST", `${menu}/publish`, { cookie: owner.cookie }),
      403,
      "FORBIDDEN",
    );
  });
});

// Tema --------------------------------------------------------------------------------------

describe("tema", () => {
  it("sin guardar responde el tema por defecto con version 0", async () => {
    const { admin, menu } = await setup();
    expect(await readTheme(menu, admin.cookie)).toEqual({
      preset: "minimal",
      primaryColor: null,
      backgroundColor: null,
      textColor: null,
      fontPreset: "sans",
      productLayout: "list",
      logoAssetId: null,
      logoUrl: null,
      coverAssetId: null,
      coverUrl: null,
      showBranding: true,
      version: 0,
      updatedAt: null,
    });
  });

  it("guarda, conserva lo omitido, vuelve al preset con null y sube menuVersion en 1 cada vez", async () => {
    const { admin, branchId, menu } = await setup();
    await readTheme(menu, admin.cookie);
    const before = (await menuRow(branchId))?.menuVersion ?? 0;

    const first = await savedTheme(menu, admin.cookie, {
      version: 0,
      preset: "dark",
      primaryColor: "#ffd54f",
      fontPreset: "serif",
    });
    expect(first).toMatchObject({ preset: "dark", primaryColor: "#FFD54F", version: 1 });
    expect((await menuRow(branchId))?.menuVersion).toBe(before + 1);

    const second = await savedTheme(menu, admin.cookie, { version: 1, primaryColor: null });
    expect(second).toMatchObject({
      preset: "dark",
      primaryColor: null,
      fontPreset: "serif",
      version: 2,
    });
    expect((await menuRow(branchId))?.menuVersion).toBe(before + 2);
  });

  it("version vieja → 409 sin subir menuVersion", async () => {
    const { owner, branchId, menu } = await setup();
    await savedTheme(menu, owner.cookie, { preset: "vibrant" });
    const version = (await menuRow(branchId))?.menuVersion;

    await expectError(await putTheme(menu, owner.cookie, { preset: "dark" }), 409, "CONFLICT");
    await expectError(
      await putTheme(menu, owner.cookie, { version: 7, preset: "dark" }),
      409,
      "CONFLICT",
    );
    expect((await menuRow(branchId))?.menuVersion).toBe(version);
    expect((await readTheme(menu, owner.cookie)).preset).toBe("vibrant");
  });

  it("color principal sin contraste con el fondo → 400 en primaryColor", async () => {
    const { owner, menu } = await setup();
    const body = await expectError(
      await putTheme(menu, owner.cookie, { preset: "minimal", primaryColor: "#FFEE58" }),
      400,
      "VALIDATION_FAILED",
    );
    expect(Object.keys(body.fieldErrors ?? {})).toEqual(["primaryColor"]);
    expect(body.fieldErrors?.primaryColor?.[0]).toContain("más oscuro");
  });

  it("texto sin contraste con un fondo propio → 400 en textColor", async () => {
    const { owner, menu } = await setup();
    const body = await expectError(
      await putTheme(menu, owner.cookie, {
        primaryColor: "#F5A300",
        backgroundColor: "#17191A",
        textColor: "#2A2A2A",
      }),
      400,
      "VALIDATION_FAILED",
    );
    expect(Object.keys(body.fieldErrors ?? {})).toEqual(["textColor"]);
  });

  it("un color mal formado → 400", async () => {
    const { owner, menu } = await setup();
    const body = await expectError(
      await putTheme(menu, owner.cookie, { primaryColor: "rojo" }),
      400,
      "VALIDATION_FAILED",
    );
    expect(body.fieldErrors).toHaveProperty("primaryColor");
  });

  it("logo y portada de la organización salen con URL; una imagen de otra organización → 404", async () => {
    const { owner, base, menu } = await setup();
    const logo = await upload(base, owner.cookie);
    const theme = await savedTheme(menu, owner.cookie, {
      logoAssetId: logo.id,
      coverAssetId: logo.id,
    });
    expect(theme).toMatchObject({ logoAssetId: logo.id, logoUrl: logo.url, coverUrl: logo.url });

    const other = await setup();
    const foreign = await upload(other.base, other.owner.cookie);
    const body = await expectError(
      await putTheme(menu, owner.cookie, { version: 1, logoAssetId: foreign.id }),
      404,
      "NOT_FOUND",
    );
    expect(body.fieldErrors).toHaveProperty("logoAssetId");
  });

  it("una imagen usada como logo no se puede borrar", async () => {
    const { owner, base, menu } = await setup();
    const logo = await upload(base, owner.cookie);
    await savedTheme(menu, owner.cookie, { logoAssetId: logo.id });
    const body = await expectError(
      await callApi("DELETE", `${base}/media/${logo.id}`, { cookie: owner.cookie }),
      422,
      "BUSINESS_RULE",
    );
    expect(body.message).toBe(IMAGE_IN_USE);
  });
});

describe("marca por plan", () => {
  it("plan free: logo, fondo, fuente o quitar el sello → 402; preset y color principal → 200", async () => {
    const { owner, base, menu } = await setup({ planId: "free" });
    const logo = await upload(base, owner.cookie);
    const forbiddenOnFree = [
      { logoAssetId: logo.id },
      { backgroundColor: "#000000" },
      { textColor: "#111111" },
      { fontPreset: "serif" },
      { productLayout: "grid" },
      { coverAssetId: logo.id },
      { showBranding: false },
    ];
    await Promise.all(
      forbiddenOnFree.map(async (body) =>
        expectError(await putTheme(menu, owner.cookie, body), 402, "PLAN_LIMIT_REACHED"),
      ),
    );
    const theme = await savedTheme(menu, owner.cookie, {
      preset: "vibrant",
      primaryColor: "#1F5C45",
    });
    expect(theme).toMatchObject({ preset: "vibrant", primaryColor: "#1F5C45", showBranding: true });
  });

  it("al bajar de pro a free, el público ve el tema base con sello y la fila guardada no cambia", async () => {
    const context = await published();
    const { owner, base, menu, org, slug } = context;
    const logo = await upload(base, owner.cookie);
    await savedTheme(menu, owner.cookie, {
      preset: "dark",
      primaryColor: "#FFD54F",
      backgroundColor: "#0D1B2A",
      textColor: "#E0E1DD",
      fontPreset: "serif",
      productLayout: "grid",
      logoAssetId: logo.id,
      showBranding: false,
    });
    expect((await publicMenu(slug)).theme).toEqual({
      preset: "dark",
      primaryColor: "#FFD54F",
      backgroundColor: "#0D1B2A",
      textColor: "#E0E1DD",
      fontPreset: "serif",
      productLayout: "grid",
      logoUrl: logo.url,
      coverUrl: null,
      showBranding: false,
    });
    const [stored] = await db()
      .select()
      .from(storefrontThemes)
      .where(eq(storefrontThemes.organizationId, org.orgId));

    await db()
      .update(subscriptions)
      .set({ planId: "free" })
      .where(eq(subscriptions.organizationId, org.orgId));
    expect((await publicMenu(slug)).theme).toEqual({
      preset: "dark",
      primaryColor: "#FFD54F",
      backgroundColor: THEME_PRESET_COLORS.dark.backgroundColor,
      textColor: THEME_PRESET_COLORS.dark.textColor,
      fontPreset: "sans",
      productLayout: "list",
      logoUrl: null,
      coverUrl: null,
      showBranding: true,
    });
    const [after] = await db()
      .select()
      .from(storefrontThemes)
      .where(eq(storefrontThemes.organizationId, org.orgId));
    expect(after).toEqual(stored);

    // En free, el contraste se valida contra el fondo del preset: el amarillo guardado no
    // alcanza sobre el fondo claro de `vibrant`.
    const rejected = await expectError(
      await putTheme(menu, owner.cookie, { version: 1, preset: "vibrant" }),
      400,
      "VALIDATION_FAILED",
    );
    expect(Object.keys(rejected.fieldErrors ?? {})).toEqual(["primaryColor"]);

    // Puede cambiar el color principal sin perder lo guardado de pro.
    await savedTheme(menu, owner.cookie, { version: 1, primaryColor: "#F5A300" });
    await db()
      .update(subscriptions)
      .set({ planId: "pro" })
      .where(eq(subscriptions.organizationId, org.orgId));
    expect((await publicMenu(slug)).theme).toMatchObject({
      preset: "dark",
      primaryColor: "#F5A300",
      backgroundColor: "#0D1B2A",
      fontPreset: "serif",
      logoUrl: logo.url,
      showBranding: false,
    });
  });
});

// Slug --------------------------------------------------------------------------------------

describe("slug", () => {
  it("se genera del nombre del negocio, sin acentos, al crear la sucursal", async () => {
    const owner = await createUser();
    const org = await createOrg({ ownerId: owner.id });
    const suffix = crypto.randomUUID().slice(0, 8);
    await renameBusiness(org.businessId, `Café Ñandú Güero ${suffix}`);
    const response = await callApi("POST", `/v1/orgs/${org.orgId}/branches`, {
      cookie: owner.cookie,
      body: { name: "Centro", modes: { table: false, pickup: true, delivery: false } },
    });
    expect(response.status).toBe(201);
    const branch = BranchDto.parse(await response.json());
    expect((await menuRow(branch.id))?.slug).toBe(`cafe-nandu-guero-${suffix}`);
  });

  it("un nombre repetido recibe -2 y -3; una sucursal anterior lo recibe al usarse", async () => {
    const name = uniqueName("Pozolería");
    const first = await setup({ businessName: name });
    const second = await setup({ businessName: name });
    expect((await menuRow(first.branchId))?.slug).toBeUndefined();

    await readTheme(first.menu, first.owner.cookie);
    await readTheme(second.menu, second.owner.cookie);
    const base = name.toLowerCase().replace(" ", "-").replace("í", "i");
    expect((await menuRow(first.branchId))?.slug).toBe(base);
    expect((await menuRow(second.branchId))?.slug).toBe(`${base}-2`);

    const third = await callApi("POST", `${second.base}/branches`, {
      cookie: second.owner.cookie,
      body: { name: "Norte", modes: { table: false, pickup: true, delivery: false } },
    });
    const branch = BranchDto.parse(await third.json());
    expect((await menuRow(branch.id))?.slug).toBe(`${base}-3`);
  });

  it("un negocio con nombre reservado no recibe el slug reservado", async () => {
    const { owner, menu } = await setup({ businessName: "Admin" });
    const response = await callApi("PATCH", `${menu}/slug`, {
      cookie: owner.cookie,
      body: { slug: "admin" },
    });
    const body = await expectError(response, 400, "VALIDATION_FAILED");
    expect(body.fieldErrors).toHaveProperty("slug");
    // La API responde un mensaje genérico; el del contrato lo muestra el formulario de WEB.
    expect(UpdateSlugInput.safeParse({ slug: "admin" }).error?.issues[0]?.message).toBe(
      SLUG_RESERVED_MESSAGE,
    );
    await addProduct(menu, owner.cookie);
    const publication = await publish(menu, owner.cookie);
    expect(publication.slug).toMatch(/^admin-\d+$/);
  });

  it("cambia antes de publicar; tomado → 409; mal formado → 400", async () => {
    const { owner, menu } = await setup();
    const other = await setup();
    await readTheme(other.menu, other.owner.cookie);
    const takenSlug = (await menuRow(other.branchId))?.slug ?? "";
    const wanted = `mi-menu-${crypto.randomUUID().slice(0, 8)}`;

    const response = await callApi("PATCH", `${menu}/slug`, {
      cookie: owner.cookie,
      body: { slug: wanted },
    });
    expect(response.status).toBe(200);
    expect(MenuPublicationDto.parse(await response.json())).toMatchObject({
      status: "draft",
      slug: wanted,
      publishedAt: null,
    });

    const taken = await expectError(
      await callApi("PATCH", `${menu}/slug`, { cookie: owner.cookie, body: { slug: takenSlug } }),
      409,
      "CONFLICT",
    );
    expect(taken.fieldErrors?.slug).toEqual([SLUG_TAKEN]);
    await Promise.all(
      ["Mayúsculas", "con espacio", "ab", "-guion", "a".repeat(51)].map(async (slug) =>
        expectError(
          await callApi("PATCH", `${menu}/slug`, { cookie: owner.cookie, body: { slug } }),
          400,
          "VALIDATION_FAILED",
        ),
      ),
    );
  });

  it("después de publicar (aunque se despublique) → 422", async () => {
    const { owner, menu } = await published();
    await callApi("POST", `${menu}/unpublish`, { cookie: owner.cookie });
    const body = await expectError(
      await callApi("PATCH", `${menu}/slug`, {
        cookie: owner.cookie,
        body: { slug: `otro-${crypto.randomUUID().slice(0, 8)}` },
      }),
      422,
      "BUSINESS_RULE",
    );
    expect(body.message).toBe(SLUG_LOCKED);
  });
});

// Publicación -------------------------------------------------------------------------------

describe("publicación", () => {
  it("sin productos disponibles → 422", async () => {
    const { owner, menu } = await setup();
    await addProduct(menu, owner.cookie, { available: false });
    const body = await expectError(
      await callApi("POST", `${menu}/publish`, { cookie: owner.cookie }),
      422,
      "BUSINESS_RULE",
    );
    expect(body.message).toBe(NO_AVAILABLE_PRODUCTS);
  });

  it("publica, sube menuVersion una vez y publicar de nuevo no cambia nada", async () => {
    const { admin, branchId, menu } = await setup();
    await addProduct(menu, admin.cookie);
    const before = (await menuRow(branchId))?.menuVersion ?? 0;

    const first = await publish(menu, admin.cookie);
    expect(first).toMatchObject({ status: "published", menuVersion: before + 1 });
    expect(first.publishedAt).not.toBeNull();
    expect(await publish(menu, admin.cookie)).toEqual(first);
  });

  it("despublicar vuelve a borrador, sube menuVersion y el público deja de verlo", async () => {
    const { owner, menu, slug } = await published();
    const before = await publicMenu(slug);
    const response = await callApi("POST", `${menu}/unpublish`, { cookie: owner.cookie });
    expect(response.status).toBe(200);
    const dto = MenuPublicationDto.parse(await response.json());
    expect(dto).toMatchObject({ status: "draft", slug, menuVersion: before.menuVersion + 1 });
    expect(dto.publishedAt).not.toBeNull();
    await expectError(await readPublic(slug), 404, "NOT_FOUND");
    await expectError(await callApi("GET", `/v1/public/menus/${slug}/version`), 404, "NOT_FOUND");
  });

  it("publicar con el correo sin verificar funciona y acceptingOrders queda en false (unverified)", async () => {
    const { slug } = await published({ ownerVerified: false });
    const dto = await publicMenu(slug);
    expect(dto.acceptingOrders).toBe(false);
    expect(dto.notAcceptingReason).toBe("unverified");
  });
});

// Lectura pública ---------------------------------------------------------------------------

describe("GET /v1/public/menus/:slug", () => {
  it("menú en borrador o inexistente → 404", async () => {
    const { owner, menu, branchId } = await setup();
    await readTheme(menu, owner.cookie);
    const slug = (await menuRow(branchId))?.slug ?? "";
    await expectError(await readPublic(slug), 404, "NOT_FOUND");
    await expectError(await readPublic("no-existe-este-menu"), 404, "NOT_FOUND");
    await expectError(await readPublic("Con%20Espacios"), 404, "NOT_FOUND");
  });

  it("publicado → 200 sin productos no disponibles ni borrados", async () => {
    const { owner, menu, slug } = await published();
    const { categoryId, product: hidden } = await addProduct(menu, owner.cookie, {
      name: "Agotado",
    });
    await callApi("PATCH", `${menu}/products/${hidden.id}/availability`, {
      cookie: owner.cookie,
      body: { version: hidden.version, available: false },
    });
    const deleted = await callApi("POST", `${menu}/products`, {
      cookie: owner.cookie,
      body: { categoryId, name: "Borrado", priceCents: 100 },
    });
    const { id: deletedId } = ProductDto.parse(await deleted.json());
    await callApi("DELETE", `${menu}/products/${deletedId}`, { cookie: owner.cookie });

    const dto = await publicMenu(slug);
    const names = dto.categories.flatMap((category) => category.products.map((p) => p.name));
    expect(names).toEqual(["Taco al pastor"]);
    expect(dto.categories).toHaveLength(1);
    expect(dto.categories[0]?.products[0]).toMatchObject({
      priceCents: 2_500,
      variants: [{ name: "Doble tortilla", priceCents: 3_000 }],
      optionGroups: [{ name: "Salsas", minSelect: 0, maxSelect: 1, options: [{ name: "Verde" }] }],
    });
    expect(dto).toMatchObject({
      slug,
      acceptingOrders: true,
      notAcceptingReason: null,
      branch: { isOpen: true, nextOpening: null },
    });
    expect(dto.branch.todayHours).toEqual([{ opensAt: "00:00", closesAt: "24:00" }]);

    const version = await callApi("GET", `/v1/public/menus/${slug}/version`);
    expect(version.status).toBe(200);
    expect(PublicMenuVersionDto.parse(await version.json())).toEqual({
      menuVersion: dto.menuVersion,
    });
  });

  it("no expone ids de la organización, códigos postales, WhatsApp ni datos de miembros", async () => {
    const context = await published();
    const { owner, org, base, branchId, slug } = context;
    const branch = await callApi("PATCH", `${base}/branches/${branchId}`, {
      cookie: owner.cookie,
      body: {
        version: 1,
        modes: { table: true, pickup: true, delivery: true },
        tableCount: 8,
        contactPhone: "+525500000000",
        alertWhatsapp: "+525511112222",
      },
    });
    expect(branch.status).toBe(200);
    const zone = await callApi("POST", `${base}/branches/${branchId}/zones`, {
      cookie: owner.cookie,
      body: { name: "Roma Norte", postalCodes: ["06700"], feeCents: 3_500 },
    });
    expect(zone.status).toBe(201);
    await callApi("POST", `${base}/branches/${branchId}/zones`, {
      cookie: owner.cookie,
      body: { name: "Pausada", postalCodes: ["06600"], feeCents: 0, active: false },
    });

    const response = await readPublic(slug);
    const text = await response.text();
    const dto = PublicMenuDto.parse(JSON.parse(text));
    expect(dto.branch).toMatchObject({
      contactPhone: "+525500000000",
      modes: { table: true, pickup: true, delivery: true },
      tableCount: 8,
      deliveryZones: [{ name: "Roma Norte", feeCents: 3_500 }],
    });
    for (const secret of [
      org.orgId,
      branchId,
      org.businessId,
      "06700",
      "06600",
      "+525511112222",
      owner.email,
      owner.id,
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("a domicilio sin zonas activas no se ofrece", async () => {
    const { owner, base, branchId, slug } = await published();
    await callApi("PATCH", `${base}/branches/${branchId}`, {
      cookie: owner.cookie,
      body: { version: 1, modes: { table: false, pickup: true, delivery: true } },
    });
    const dto = await publicMenu(slug);
    expect(dto.branch.modes.delivery).toBe(false);
    expect(dto.branch.deliveryZones).toEqual([]);
  });

  it("acceptingOrders false con suscripción suspendida y fuera de horario, con su motivo", async () => {
    const suspended = await published();
    await db()
      .update(subscriptions)
      .set({ status: "suspended" })
      .where(eq(subscriptions.organizationId, suspended.org.orgId));
    expect((await publicMenu(suspended.slug)).notAcceptingReason).toBe("suspended");

    const closed = await published();
    await callApi("PUT", `${closed.base}/branches/${closed.branchId}/hours`, {
      cookie: closed.owner.cookie,
      body: { ranges: [] },
    });
    const dto = await publicMenu(closed.slug);
    expect(dto).toMatchObject({
      acceptingOrders: false,
      notAcceptingReason: "closed",
      branch: { isOpen: false, nextOpening: null, todayHours: [] },
    });

    // Al verificar el correo del dueño, vuelve a recibir pedidos.
    const unverified = await published({ ownerVerified: false });
    await db().update(users).set({ emailVerified: true }).where(eq(users.id, unverified.owner.id));
    expect((await publicMenu(unverified.slug)).acceptingOrders).toBe(true);
  });

  it("con la gracia vencida (21 días) queda inactivo sin productos; al verificar vuelve", async () => {
    const context = await published({ ownerVerified: false });
    const { org, owner, branchId, slug } = context;
    const old = new Date(Date.now() - (UNVERIFIED_GRACE_DAYS + 1) * DAY_MS);
    await db().update(organizations).set({ createdAt: old }).where(eq(organizations.id, org.orgId));

    const inactive = await publicMenu(slug);
    expect(inactive).toMatchObject({
      acceptingOrders: false,
      notAcceptingReason: "inactive",
      categories: [],
      business: { name: expect.any(String) },
    });

    // Verificar el correo por el flujo real sube menuVersion y el menú vuelve a mostrarse.
    const before = (await menuRow(branchId))?.menuVersion ?? 0;
    const token = await createEmailVerificationToken(
      getEnv(env).BETTER_AUTH_SECRET,
      owner.email,
      undefined,
      60,
      { userId: owner.id },
    );
    const verified = await callApi(
      "GET",
      `/v1/auth/verify-email?${new URLSearchParams({ token })}`,
    );
    expect(verified.status).toBe(200);
    expect((await menuRow(branchId))?.menuVersion).toBe(before + 1);

    const active = await publicMenu(slug);
    expect(active).toMatchObject({ acceptingOrders: true, notAcceptingReason: null });
    expect(active.menuVersion).toBe(before + 1);
    expect(active.categories.flatMap((category) => category.products)).toHaveLength(1);
  });

  it("dentro de la gracia el menú se ve completo pero sin pedidos (unverified)", async () => {
    const { org, slug } = await published({ ownerVerified: false });
    const recent = new Date(Date.now() - (UNVERIFIED_GRACE_DAYS - 1) * DAY_MS);
    await db()
      .update(organizations)
      .set({ createdAt: recent })
      .where(eq(organizations.id, org.orgId));
    const dto = await publicMenu(slug);
    expect(dto.notAcceptingReason).toBe("unverified");
    expect(dto.categories).toHaveLength(1);
  });

  it("lee todo el menú en un solo db.batch", async () => {
    const { slug } = await published();
    const prepared: string[] = [];
    let batches = 0;
    const real = getEnv(env);
    const bindings: Env = {
      ...real,
      DB: new Proxy(real.DB, {
        get(target, property) {
          if (property === "prepare") {
            return (query: string) => {
              prepared.push(query);
              return target.prepare(query);
            };
          }
          if (property === "batch") {
            return (statements: D1PreparedStatement[]) => {
              batches += 1;
              return target.batch(statements);
            };
          }
          const value: unknown = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    };
    const response = await readPublic(slug, bindings);
    expect(response.status).toBe(200);
    PublicMenuDto.parse(await response.json());
    expect(batches).toBe(1);
    expect(prepared).toHaveLength(6);
  });
});
