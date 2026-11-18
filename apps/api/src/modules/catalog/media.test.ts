import {
  CategoryDto,
  ErrorResponse,
  MAX_MEDIA_BYTES,
  MEDIA_UPLOADS_PER_HOUR,
  MediaAssetDto,
  ProductDto,
} from "@menu-max/contracts";
import { mediaAssets, rateCounters } from "@menu-max/database";
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
  webpBytes,
} from "../../../test/factories";
import { callApi } from "../../../test/isolation";
import { getEnv } from "../../env";
import { createDb } from "../../infrastructure/db";
import { IMMUTABLE_CACHE_CONTROL } from "../../infrastructure/storage";
import { IMAGE_IN_USE, IMAGE_TOO_LARGE, UNSUPPORTED_IMAGE } from "./media.service";

const bindings = () => getEnv(env);
const db = () => createDb(bindings());
const HOUR_MS = 60 * 60 * 1000;
const UUIDV7 = "[\\da-f]{8}-[\\da-f]{4}-7[\\da-f]{3}-[89ab][\\da-f]{3}-[\\da-f]{12}";

async function expectError(response: Response, status: number, code: ErrorResponse["code"]) {
  expect(response.status).toBe(status);
  const body = ErrorResponse.parse(await response.json());
  expect(body.code).toBe(code);
  return body;
}

/** Organización con owner, admin, staff y una sucursal. */
async function setup() {
  const owner = await createUser();
  const org = await createOrg({ ownerId: owner.id });
  const branchId = await createBranch({ orgId: org.orgId, businessId: org.businessId });
  const admin = await createUser();
  await addMember({ orgId: org.orgId, userId: admin.id, role: "admin" });
  const staff = await createUser();
  await addMember({ orgId: org.orgId, userId: staff.id, role: "staff", branchIds: [branchId] });
  return {
    owner,
    admin,
    staff,
    org,
    media: `/v1/orgs/${org.orgId}/media`,
    menu: `/v1/orgs/${org.orgId}/branches/${branchId}/menu`,
  };
}

function upload(
  path: string,
  cookie: string | undefined,
  bytes: Uint8Array,
  contentType = "image/jpeg",
  headers: Record<string, string> = {},
) {
  return callApi("POST", path, {
    cookie,
    rawBody: bytes,
    headers: { "content-type": contentType, ...headers },
  });
}

async function uploaded(path: string, cookie: string, bytes = jpegBytes(1200, 800)) {
  const response = await upload(path, cookie, bytes);
  expect(response.status).toBe(201);
  return MediaAssetDto.parse(await response.json());
}

async function assetRow(id: string) {
  const [row] = await db().select().from(mediaAssets).where(eq(mediaAssets.id, id));
  return row;
}

describe("POST /media", () => {
  it.each([
    ["JPEG", jpegBytes(1200, 800), "image/jpeg", "jpg", 1200, 800],
    ["PNG", pngBytes(1024, 768), "image/png", "png", 1024, 768],
    ["WebP", webpBytes(800, 600), "image/webp", "webp", 800, 600],
  ] as const)(
    "%s válido → 201 con dimensiones; objeto en R2 y metadato en D1",
    async (_, bytes, contentType, ext, width, height) => {
      const { admin, org, media } = await setup();
      const response = await upload(media, admin.cookie, bytes, contentType);
      expect(response.status).toBe(201);
      const dto = MediaAssetDto.parse(await response.json());
      expect(dto).toMatchObject({ width, height });

      const row = await assetRow(dto.id);
      expect(row).toMatchObject({
        organizationId: org.orgId,
        contentType,
        sizeBytes: bytes.byteLength,
        width,
        height,
        deletedAt: null,
      });
      expect(row?.key).toBe(`org/${org.orgId}/media/${dto.id}.${ext}`);
      expect(dto.url).toBe(`${bindings().MEDIA_PUBLIC_BASE_URL}/${row?.key}`);

      const object = await bindings().MEDIA.get(row?.key ?? "");
      expect(object?.httpMetadata).toMatchObject({
        contentType,
        cacheControl: IMMUTABLE_CACHE_CONTROL,
      });
      expect(new Uint8Array((await object?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(bytes);
    },
  );

  it("el tipo real manda: un PNG declarado como image/jpeg se guarda como PNG", async () => {
    const { owner, media } = await setup();
    const dto = await uploaded(media, owner.cookie, pngBytes(10, 20));
    expect(dto.url).toMatch(/\.png$/);
    expect((await assetRow(dto.id))?.contentType).toBe("image/png");
  });

  it("la llave no contiene el nombre original del archivo", async () => {
    const { owner, org, media } = await setup();
    const response = await upload(media, owner.cookie, jpegBytes(10, 10), "image/jpeg", {
      "content-disposition": 'attachment; filename="tacos-al-pastor.jpg"',
      "x-file-name": "tacos-al-pastor.jpg",
    });
    expect(response.status).toBe(201);
    const dto = MediaAssetDto.parse(await response.json());
    const key = (await assetRow(dto.id))?.key ?? "";
    expect(key).toMatch(new RegExp(`^org/${org.orgId}/media/${UUIDV7}\\.jpg$`));
    expect(key).not.toContain("tacos");
  });

  it("un .exe renombrado a .jpg con content-type image/jpeg → 400 sin guardar nada", async () => {
    const { owner, org, media } = await setup();
    const exe = new Uint8Array(512);
    exe.set([0x4d, 0x5a, 0x90, 0x00]);
    const error = await expectError(
      await upload(media, owner.cookie, exe, "image/jpeg", {
        "content-disposition": 'attachment; filename="foto.jpg"',
      }),
      400,
      "VALIDATION_FAILED",
    );
    expect(error.message).toBe(UNSUPPORTED_IMAGE);
    const listed = await bindings().MEDIA.list({ prefix: `org/${org.orgId}/` });
    expect(listed.objects).toHaveLength(0);
    expect(
      await db().select().from(mediaAssets).where(eq(mediaAssets.organizationId, org.orgId)),
    ).toHaveLength(0);
  });

  it.each(["application/octet-stream", "image/gif", "image/svg+xml", undefined])(
    "content-type declarado %s → 400",
    async (contentType) => {
      const { owner, media } = await setup();
      const response = await callApi("POST", media, {
        cookie: owner.cookie,
        rawBody: jpegBytes(10, 10),
        headers: contentType ? { "content-type": contentType } : {},
      });
      await expectError(response, 400, "VALIDATION_FAILED");
    },
  );

  it("más de 6000 px por lado → 400", async () => {
    const { owner, media } = await setup();
    const error = await expectError(
      await upload(media, owner.cookie, webpBytes(6001, 10, "VP8X"), "image/webp"),
      400,
      "VALIDATION_FAILED",
    );
    expect(error.message).toBe(IMAGE_TOO_LARGE);
    expect(
      (await upload(media, owner.cookie, webpBytes(6000, 6000, "VP8X"), "image/webp")).status,
    ).toBe(201);
  });

  it("5 MB + 1 byte → 413; exactamente 5 MB pasa", async () => {
    const { owner, media } = await setup();
    const header = jpegBytes(100, 100);
    const exact = new Uint8Array(MAX_MEDIA_BYTES);
    exact.set(header);
    expect((await upload(media, owner.cookie, exact)).status).toBe(201);

    const tooBig = new Uint8Array(MAX_MEDIA_BYTES + 1);
    tooBig.set(header);
    await expectError(await upload(media, owner.cookie, tooBig), 413, "PAYLOAD_TOO_LARGE");
  });

  it("las demás rutas conservan el límite de 64 KB", async () => {
    const { owner, menu } = await setup();
    const response = await callApi("POST", `${menu}/categories`, {
      cookie: owner.cookie,
      body: { name: "x".repeat(65 * 1024) },
    });
    await expectError(response, 413, "PAYLOAD_TOO_LARGE");
  });

  it(`la subida ${MEDIA_UPLOADS_PER_HOUR + 1} de la hora → 429 con Retry-After`, async () => {
    const { owner, org, media } = await setup();
    const now = Date.now();
    const windowStart = Math.floor(now / HOUR_MS) * HOUR_MS;
    await db()
      .insert(rateCounters)
      .values({
        key: `media:${org.orgId}`,
        windowStart,
        count: MEDIA_UPLOADS_PER_HOUR - 1,
        expiresAt: windowStart + HOUR_MS,
      });

    // Una imagen inválida no gasta el cupo.
    await expectError(
      await upload(media, owner.cookie, new Uint8Array(8)),
      400,
      "VALIDATION_FAILED",
    );
    expect((await upload(media, owner.cookie, jpegBytes(10, 10))).status).toBe(201);
    const response = await upload(media, owner.cookie, jpegBytes(10, 10));
    await expectError(response, 429, "RATE_LIMITED");
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("sin sesión → 401; staff → 403", async () => {
    const { staff, media } = await setup();
    await expectError(await upload(media, undefined, jpegBytes(10, 10)), 401, "AUTH_REQUIRED");
    await expectError(await upload(media, staff.cookie, jpegBytes(10, 10)), 403, "FORBIDDEN");
  });

  it("miembro de otra organización → 404", async () => {
    const { media } = await setup();
    const intruder = await setup();
    await expectError(
      await upload(media, intruder.owner.cookie, jpegBytes(10, 10)),
      404,
      "NOT_FOUND",
    );
  });

  it("con la suscripción suspendida no se puede subir (403)", async () => {
    const owner = await createUser();
    const org = await createOrg({ ownerId: owner.id, status: "suspended" });
    await expectError(
      await upload(`/v1/orgs/${org.orgId}/media`, owner.cookie, jpegBytes(10, 10)),
      403,
      "FORBIDDEN",
    );
  });
});

describe("DELETE /media/:mediaId", () => {
  it("borrado lógico → 204; borrar de nuevo → 404; el objeto sigue en R2 hasta T26", async () => {
    const { admin, media } = await setup();
    const asset = await uploaded(media, admin.cookie);
    const response = await callApi("DELETE", `${media}/${asset.id}`, { cookie: admin.cookie });
    expect(response.status).toBe(204);
    const row = await assetRow(asset.id);
    expect(row?.deletedAt).not.toBeNull();
    expect(await bindings().MEDIA.head(row?.key ?? "")).not.toBeNull();

    await expectError(
      await callApi("DELETE", `${media}/${asset.id}`, { cookie: admin.cookie }),
      404,
      "NOT_FOUND",
    );
  });

  it("una imagen que usa un producto activo → 422; al quitarla del producto, se borra", async () => {
    const { owner, media, menu } = await setup();
    const asset = await uploaded(media, owner.cookie);
    const category = await callApi("POST", `${menu}/categories`, {
      cookie: owner.cookie,
      body: { name: "Tacos" },
    });
    const { id: categoryId } = CategoryDto.parse(await category.json());
    const created = await callApi("POST", `${menu}/products`, {
      cookie: owner.cookie,
      body: { categoryId, name: "Taco al pastor", priceCents: 2_500 },
    });
    const product = ProductDto.parse(await created.json());
    const patched = await callApi("PATCH", `${menu}/products/${product.id}`, {
      cookie: owner.cookie,
      body: { version: product.version, imageAssetId: asset.id },
    });
    expect(patched.status).toBe(200);

    const error = await expectError(
      await callApi("DELETE", `${media}/${asset.id}`, { cookie: owner.cookie }),
      422,
      "BUSINESS_RULE",
    );
    expect(error.message).toBe(IMAGE_IN_USE);

    const removed = await callApi("PATCH", `${menu}/products/${product.id}`, {
      cookie: owner.cookie,
      body: { version: product.version + 1, imageAssetId: null },
    });
    expect(ProductDto.parse(await removed.json()).imageUrl).toBeNull();
    expect((await callApi("DELETE", `${media}/${asset.id}`, { cookie: owner.cookie })).status).toBe(
      204,
    );
  });

  it("un producto borrado no impide borrar su imagen", async () => {
    const { owner, media, menu } = await setup();
    const asset = await uploaded(media, owner.cookie);
    const category = await callApi("POST", `${menu}/categories`, {
      cookie: owner.cookie,
      body: { name: "Tacos" },
    });
    const { id: categoryId } = CategoryDto.parse(await category.json());
    const created = await callApi("POST", `${menu}/products`, {
      cookie: owner.cookie,
      body: { categoryId, name: "Taco al pastor", priceCents: 2_500 },
    });
    const product = ProductDto.parse(await created.json());
    await callApi("PATCH", `${menu}/products/${product.id}`, {
      cookie: owner.cookie,
      body: { version: 1, imageAssetId: asset.id },
    });
    await callApi("DELETE", `${menu}/products/${product.id}`, { cookie: owner.cookie });
    expect((await callApi("DELETE", `${media}/${asset.id}`, { cookie: owner.cookie })).status).toBe(
      204,
    );
  });

  it("sin sesión → 401; staff → 403; id mal formado → 404", async () => {
    const { owner, staff, media } = await setup();
    const asset = await uploaded(media, owner.cookie);
    await expectError(await callApi("DELETE", `${media}/${asset.id}`), 401, "AUTH_REQUIRED");
    await expectError(
      await callApi("DELETE", `${media}/${asset.id}`, { cookie: staff.cookie }),
      403,
      "FORBIDDEN",
    );
    await expectError(
      await callApi("DELETE", `${media}/no-es-un-id`, { cookie: owner.cookie }),
      404,
      "NOT_FOUND",
    );
    expect((await assetRow(asset.id))?.deletedAt).toBeNull();
  });

  it("miembro de otra organización con el id real → 404 por las dos rutas", async () => {
    const victim = await setup();
    const asset = await uploaded(victim.media, victim.owner.cookie);
    const intruder = await setup();
    await Promise.all(
      [`${victim.media}/${asset.id}`, `${intruder.media}/${asset.id}`].map(async (path) =>
        expectError(
          await callApi("DELETE", path, { cookie: intruder.owner.cookie }),
          404,
          "NOT_FOUND",
        ),
      ),
    );
    expect((await assetRow(asset.id))?.deletedAt).toBeNull();
  });
});
