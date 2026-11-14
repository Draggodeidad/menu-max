import {
  BranchDetailDto,
  BranchDto,
  BranchHoursDto,
  BranchListDto,
  BusinessDto,
  ErrorResponse,
  MODES_REQUIRED,
  TABLES_REQUIRED,
} from "@menu-max/contracts";
import { businessHours } from "@menu-max/database";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addMember, createBranch, createOrg, createUser } from "../../../test/factories";
import { callApi, expectNotFoundForOtherTenant } from "../../../test/isolation";
import { getEnv } from "../../env";
import { createDb } from "../../infrastructure/db";
import { loadTenant } from "../organizations/organizations.service";
import { replaceHours } from "./businesses.repository";
import { OVERLAPPING_HOURS } from "./hours";

const db = () => createDb(getEnv(env));

async function expectError(response: Response, status: number, code: ErrorResponse["code"]) {
  expect(response.status).toBe(status);
  const body = ErrorResponse.parse(await response.json());
  expect(body.code).toBe(code);
  return body;
}

/** Organización con owner, una sucursal, un admin y un staff asignado a esa sucursal. */
async function setup(options: { planId?: string } = {}) {
  const owner = await createUser();
  const org = await createOrg({ ownerId: owner.id, planId: options.planId });
  const branchId = await createBranch({ orgId: org.orgId, businessId: org.businessId });
  const admin = await createUser();
  await addMember({ orgId: org.orgId, userId: admin.id, role: "admin" });
  const staff = await createUser();
  await addMember({ orgId: org.orgId, userId: staff.id, role: "staff", branchIds: [branchId] });
  const base = `/v1/orgs/${org.orgId}`;
  return { owner, admin, staff, org, branchId, base };
}

/** Owner de otra organización, con su propia sucursal. */
async function intruderOrg() {
  const intruder = await createUser();
  const org = await createOrg({ ownerId: intruder.id });
  const branchId = await createBranch({ orgId: org.orgId, businessId: org.businessId });
  return { intruder, orgId: org.orgId, branchId };
}

const newBranch = {
  name: "Sucursal Norte",
  modes: { table: true, pickup: true, delivery: false },
  tableCount: 12,
};

describe("sin sesión", () => {
  it("todas las rutas nuevas responden 401", async () => {
    const { base, branchId } = await setup();
    const routes: [string, string, unknown?][] = [
      ["GET", `${base}/business`],
      ["PATCH", `${base}/business`, { name: "Otro" }],
      ["GET", `${base}/branches`],
      ["POST", `${base}/branches`, newBranch],
      ["GET", `${base}/branches/${branchId}`],
      ["PATCH", `${base}/branches/${branchId}`, { version: 1, name: "Otro" }],
      ["PUT", `${base}/branches/${branchId}/hours`, { ranges: [] }],
    ];
    await Promise.all(
      routes.map(async ([method, path, body]) => {
        await expectError(await callApi(method, path, { body }), 401, "AUTH_REQUIRED");
      }),
    );
  });
});

describe("GET/PATCH /business", () => {
  it("cualquier miembro lo lee; owner y admin cambian el nombre", async () => {
    const { owner, admin, staff, base, org } = await setup();
    await Promise.all(
      [owner, admin, staff].map(async (user) => {
        const response = await callApi("GET", `${base}/business`, { cookie: user.cookie });
        expect(response.status).toBe(200);
        expect(BusinessDto.parse(await response.json())).toEqual({
          id: org.businessId,
          name: "Tacos El Güero",
        });
      }),
    );
    const response = await callApi("PATCH", `${base}/business`, {
      cookie: admin.cookie,
      body: { name: "  Tacos El Güero Norte " },
    });
    expect(response.status).toBe(200);
    expect(BusinessDto.parse(await response.json()).name).toBe("Tacos El Güero Norte");
  });

  it("staff no puede cambiar el nombre (403)", async () => {
    const { staff, base } = await setup();
    await expectError(
      await callApi("PATCH", `${base}/business`, { cookie: staff.cookie, body: { name: "X" } }),
      403,
      "FORBIDDEN",
    );
  });

  it("llaves desconocidas o nombre vacío → 400", async () => {
    const { owner, base } = await setup();
    await Promise.all(
      [{ name: " " }, { name: "Ok", id: "x" }].map(async (body) => {
        await expectError(
          await callApi("PATCH", `${base}/business`, { cookie: owner.cookie, body }),
          400,
          "VALIDATION_FAILED",
        );
      }),
    );
  });

  it("otra organización → 404", async () => {
    const { org } = await setup();
    const { intruder } = await intruderOrg();
    await expectNotFoundForOtherTenant({
      intruder,
      paths: [`/v1/orgs/${org.orgId}/business`],
    });
    await expectNotFoundForOtherTenant({
      intruder,
      method: "PATCH",
      body: { name: "Robado" },
      paths: [`/v1/orgs/${org.orgId}/business`],
    });
  });
});

describe("GET /branches", () => {
  it("owner ve todas; staff solo las asignadas", async () => {
    const { owner, staff, org, branchId, base } = await setup();
    const other = await createBranch({ orgId: org.orgId, businessId: org.businessId });

    const all = BranchListDto.parse(
      await (await callApi("GET", `${base}/branches`, { cookie: owner.cookie })).json(),
    );
    expect(new Set(all.items.map((b) => b.id))).toEqual(new Set([branchId, other]));

    const mine = BranchListDto.parse(
      await (await callApi("GET", `${base}/branches`, { cookie: staff.cookie })).json(),
    );
    expect(mine.items.map((b) => b.id)).toEqual([branchId]);
  });

  it("pagina por cursor", async () => {
    const { owner, org, base } = await setup();
    await createBranch({ orgId: org.orgId, businessId: org.businessId });
    const first = BranchListDto.parse(
      await (await callApi("GET", `${base}/branches?limit=1`, { cookie: owner.cookie })).json(),
    );
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = BranchListDto.parse(
      await (
        await callApi("GET", `${base}/branches?limit=1&cursor=${first.nextCursor}`, {
          cookie: owner.cookie,
        })
      ).json(),
    );
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });

  it("otra organización → 404 y su lista no incluye sucursales ajenas", async () => {
    const { org, branchId } = await setup();
    const { intruder, orgId } = await intruderOrg();
    await expectNotFoundForOtherTenant({ intruder, paths: [`/v1/orgs/${org.orgId}/branches`] });
    const own = BranchListDto.parse(
      await (
        await callApi("GET", `/v1/orgs/${orgId}/branches`, { cookie: intruder.cookie })
      ).json(),
    );
    expect(own.items.map((b) => b.id)).not.toContain(branchId);
  });
});

describe("POST /branches", () => {
  it("crea la sucursal en el negocio de la organización y registra el opt-in de avisos", async () => {
    const owner = await createUser();
    const org = await createOrg({ ownerId: owner.id });
    const response = await callApi("POST", `/v1/orgs/${org.orgId}/branches`, {
      cookie: owner.cookie,
      body: { ...newBranch, alertWhatsapp: "+525500000000", contactPhone: "+525500000001" },
    });
    expect(response.status).toBe(201);
    const branch = BranchDto.parse(await response.json());
    expect(branch).toMatchObject({
      businessId: org.businessId,
      name: "Sucursal Norte",
      timezone: "America/Mexico_City",
      modes: newBranch.modes,
      tableCount: 12,
      maxOrderTotalCents: null,
      alertWhatsapp: "+525500000000",
      contactPhone: "+525500000001",
      version: 1,
    });
    expect(branch.alertOptInAt).not.toBeNull();
  });

  it("segunda sucursal en plan free → 402", async () => {
    const { owner, base } = await setup({ planId: "free" });
    await expectError(
      await callApi("POST", `${base}/branches`, { cookie: owner.cookie, body: newBranch }),
      402,
      "PLAN_LIMIT_REACHED",
    );
  });

  it("staff no crea sucursales (403); admin sí", async () => {
    const { staff, admin, base } = await setup();
    await expectError(
      await callApi("POST", `${base}/branches`, { cookie: staff.cookie, body: newBranch }),
      403,
      "FORBIDDEN",
    );
    const response = await callApi("POST", `${base}/branches`, {
      cookie: admin.cookie,
      body: newBranch,
    });
    expect(response.status).toBe(201);
  });

  it("sin modalidades o en mesa sin mesas → VALIDATION_FAILED con el campo", async () => {
    const { owner, base } = await setup();
    const noModes = await expectError(
      await callApi("POST", `${base}/branches`, {
        cookie: owner.cookie,
        body: { name: "X", modes: { table: false, pickup: false, delivery: false } },
      }),
      400,
      "VALIDATION_FAILED",
    );
    expect(noModes.fieldErrors?.modes).toEqual([MODES_REQUIRED]);
    const noTables = await expectError(
      await callApi("POST", `${base}/branches`, {
        cookie: owner.cookie,
        body: { name: "X", modes: { table: true, pickup: false, delivery: false } },
      }),
      400,
      "VALIDATION_FAILED",
    );
    expect(noTables.fieldErrors?.tableCount).toEqual([TABLES_REQUIRED]);
  });

  it("teléfono fuera de E.164, zona horaria inválida o más de 200 mesas → 400", async () => {
    const { owner, base } = await setup();
    await Promise.all(
      [
        { alertWhatsapp: "55 0000 0000" },
        { timezone: "Marte/Olympus" },
        { tableCount: 201 },
        { maxOrderTotalCents: 10.5 },
      ].map(async (extra) => {
        await expectError(
          await callApi("POST", `${base}/branches`, {
            cookie: owner.cookie,
            body: { ...newBranch, ...extra },
          }),
          400,
          "VALIDATION_FAILED",
        );
      }),
    );
  });

  it("otra organización → 404", async () => {
    const { org } = await setup();
    const { intruder } = await intruderOrg();
    await expectNotFoundForOtherTenant({
      intruder,
      method: "POST",
      body: newBranch,
      paths: [`/v1/orgs/${org.orgId}/branches`],
    });
  });
});

describe("GET /branches/:branchId", () => {
  it("devuelve la sucursal con su horario", async () => {
    const { owner, base, branchId } = await setup();
    await callApi("PUT", `${base}/branches/${branchId}/hours`, {
      cookie: owner.cookie,
      body: { ranges: [{ weekday: 1, opensAt: "09:00", closesAt: "18:00" }] },
    });
    const response = await callApi("GET", `${base}/branches/${branchId}`, {
      cookie: owner.cookie,
    });
    expect(response.status).toBe(200);
    const branch = BranchDetailDto.parse(await response.json());
    expect(branch.id).toBe(branchId);
    expect(branch.hours).toEqual([{ weekday: 1, opensAt: "09:00", closesAt: "18:00" }]);
  });

  it("staff lee su sucursal; una no asignada → 404", async () => {
    const { staff, org, base, branchId } = await setup();
    const other = await createBranch({ orgId: org.orgId, businessId: org.businessId });
    expect(
      (await callApi("GET", `${base}/branches/${branchId}`, { cookie: staff.cookie })).status,
    ).toBe(200);
    await expectError(
      await callApi("GET", `${base}/branches/${other}`, { cookie: staff.cookie }),
      404,
      "NOT_FOUND",
    );
  });

  it("id mal formado → 404", async () => {
    const { owner, base } = await setup();
    await expectError(
      await callApi("GET", `${base}/branches/no-es-uuid`, { cookie: owner.cookie }),
      404,
      "NOT_FOUND",
    );
  });

  it("otra organización → 404 por las dos vías", async () => {
    const { org, branchId } = await setup();
    const { intruder, orgId } = await intruderOrg();
    await expectNotFoundForOtherTenant({
      intruder,
      paths: [
        `/v1/orgs/${org.orgId}/branches/${branchId}`,
        `/v1/orgs/${orgId}/branches/${branchId}`,
      ],
    });
  });
});

describe("PATCH /branches/:branchId", () => {
  it("admin edita; la versión sube y la vieja → 409", async () => {
    const { admin, base, branchId } = await setup();
    const response = await callApi("PATCH", `${base}/branches/${branchId}`, {
      cookie: admin.cookie,
      body: { version: 1, name: "Centro Histórico", maxOrderTotalCents: 150_000 },
    });
    expect(response.status).toBe(200);
    const branch = BranchDto.parse(await response.json());
    expect(branch).toMatchObject({
      name: "Centro Histórico",
      maxOrderTotalCents: 150_000,
      version: 2,
    });

    const stale = await expectError(
      await callApi("PATCH", `${base}/branches/${branchId}`, {
        cookie: admin.cookie,
        body: { version: 1, name: "Otro" },
      }),
      409,
      "CONFLICT",
    );
    expect(stale.message).toContain("Actualiza la página");
  });

  it("staff no puede editar su sucursal (403)", async () => {
    const { staff, base, branchId } = await setup();
    await expectError(
      await callApi("PATCH", `${base}/branches/${branchId}`, {
        cookie: staff.cookie,
        body: { version: 1, name: "Otro" },
      }),
      403,
      "FORBIDDEN",
    );
  });

  it("desactivar las tres modalidades → VALIDATION_FAILED y no cambia nada", async () => {
    const { owner, base, branchId } = await setup();
    const error = await expectError(
      await callApi("PATCH", `${base}/branches/${branchId}`, {
        cookie: owner.cookie,
        body: { version: 1, modes: { table: false, pickup: false, delivery: false } },
      }),
      400,
      "VALIDATION_FAILED",
    );
    expect(error.fieldErrors?.modes).toEqual([MODES_REQUIRED]);
    const branch = BranchDetailDto.parse(
      await (await callApi("GET", `${base}/branches/${branchId}`, { cookie: owner.cookie })).json(),
    );
    expect(branch.version).toBe(1);
  });

  it("activar mesas exige mesas: con la cuenta guardada en 0 → 400; enviándolas → 200", async () => {
    const { owner, base, branchId } = await setup();
    const modes = { table: true, pickup: true, delivery: false };
    const error = await expectError(
      await callApi("PATCH", `${base}/branches/${branchId}`, {
        cookie: owner.cookie,
        body: { version: 1, modes },
      }),
      400,
      "VALIDATION_FAILED",
    );
    expect(error.fieldErrors?.tableCount).toEqual([TABLES_REQUIRED]);
    const response = await callApi("PATCH", `${base}/branches/${branchId}`, {
      cookie: owner.cookie,
      body: { version: 1, modes, tableCount: 8 },
    });
    expect(BranchDto.parse(await response.json())).toMatchObject({ modes, tableCount: 8 });
  });

  it("alertWhatsapp: otro número renueva el opt-in, el mismo lo conserva y null lo borra", async () => {
    const { owner, base, branchId } = await setup();
    const patch = async (version: number, alertWhatsapp: string | null) =>
      BranchDto.parse(
        await (
          await callApi("PATCH", `${base}/branches/${branchId}`, {
            cookie: owner.cookie,
            body: { version, alertWhatsapp },
          })
        ).json(),
      );
    const first = await patch(1, "+525500000000");
    expect(first.alertOptInAt).not.toBeNull();
    const same = await patch(2, "+525500000000");
    expect(same.alertOptInAt).toBe(first.alertOptInAt);
    const cleared = await patch(3, null);
    expect(cleared).toMatchObject({ alertWhatsapp: null, alertOptInAt: null });
  });

  it("sin version → 400", async () => {
    const { owner, base, branchId } = await setup();
    await expectError(
      await callApi("PATCH", `${base}/branches/${branchId}`, {
        cookie: owner.cookie,
        body: { name: "Otro" },
      }),
      400,
      "VALIDATION_FAILED",
    );
  });

  it("otra organización → 404 por las dos vías", async () => {
    const { org, branchId } = await setup();
    const { intruder, orgId } = await intruderOrg();
    await expectNotFoundForOtherTenant({
      intruder,
      method: "PATCH",
      body: { version: 1, name: "Robado" },
      paths: [
        `/v1/orgs/${org.orgId}/branches/${branchId}`,
        `/v1/orgs/${orgId}/branches/${branchId}`,
      ],
    });
  });
});

describe("PUT /branches/:branchId/hours", () => {
  it("reemplaza la semana completa y parte los rangos que cruzan la medianoche", async () => {
    const { owner, base, branchId } = await setup();
    const put = (ranges: unknown[]) =>
      callApi("PUT", `${base}/branches/${branchId}/hours`, {
        cookie: owner.cookie,
        body: { ranges },
      });
    await put([{ weekday: 2, opensAt: "08:00", closesAt: "12:00" }]);
    const response = await put([
      { weekday: 5, opensAt: "20:00", closesAt: "02:00" },
      { weekday: 1, opensAt: "17:00", closesAt: "22:00" },
      { weekday: 1, opensAt: "09:00", closesAt: "13:00" },
    ]);
    expect(response.status).toBe(200);
    const expected = [
      { weekday: 1, opensAt: "09:00", closesAt: "13:00" },
      { weekday: 1, opensAt: "17:00", closesAt: "22:00" },
      { weekday: 5, opensAt: "20:00", closesAt: "24:00" },
      { weekday: 6, opensAt: "00:00", closesAt: "02:00" },
    ];
    expect(BranchHoursDto.parse(await response.json()).ranges).toEqual(expected);
    const branch = BranchDetailDto.parse(
      await (await callApi("GET", `${base}/branches/${branchId}`, { cookie: owner.cookie })).json(),
    );
    expect(branch.hours).toEqual(expected);

    expect((await put([])).status).toBe(200);
    const rows = await db()
      .select()
      .from(businessHours)
      .where(eq(businessHours.branchId, branchId));
    expect(rows).toEqual([]);
  });

  it("rangos que se enciman o con apertura igual al cierre → 400", async () => {
    const { owner, base, branchId } = await setup();
    const overlap = await expectError(
      await callApi("PUT", `${base}/branches/${branchId}/hours`, {
        cookie: owner.cookie,
        body: {
          ranges: [
            { weekday: 1, opensAt: "09:00", closesAt: "15:00" },
            { weekday: 1, opensAt: "14:00", closesAt: "20:00" },
          ],
        },
      }),
      400,
      "VALIDATION_FAILED",
    );
    expect(overlap.fieldErrors?.ranges).toEqual([OVERLAPPING_HOURS]);
    await Promise.all(
      [
        { weekday: 1, opensAt: "09:00", closesAt: "09:00" },
        { weekday: 7, opensAt: "09:00", closesAt: "10:00" },
        { weekday: 1, opensAt: "9:00", closesAt: "10:00" },
        { weekday: 1, opensAt: "24:00", closesAt: "10:00" },
      ].map(async (range) => {
        await expectError(
          await callApi("PUT", `${base}/branches/${branchId}/hours`, {
            cookie: owner.cookie,
            body: { ranges: [range] },
          }),
          400,
          "VALIDATION_FAILED",
        );
      }),
    );
  });

  it("es atómico: si una inserción falla, la semana anterior queda intacta", async () => {
    const { owner, org, base, branchId } = await setup();
    await callApi("PUT", `${base}/branches/${branchId}/hours`, {
      cookie: owner.cookie,
      body: { ranges: [{ weekday: 3, opensAt: "10:00", closesAt: "14:00" }] },
    });
    const tenant = await loadTenant(db(), org.orgId, owner.id, "prueba");
    if (!tenant) throw new Error("Sin membresía");
    // Rango inválido que solo rechaza el CHECK de la base (el servicio nunca lo enviaría).
    await expect(
      replaceHours(db(), tenant, branchId, [
        { weekday: 1, opensAt: "09:00", closesAt: "10:00" },
        { weekday: 2, opensAt: "18:00", closesAt: "08:00" },
      ]),
    ).rejects.toThrow();
    const rows = await db()
      .select()
      .from(businessHours)
      .where(eq(businessHours.branchId, branchId));
    expect(rows.map(({ weekday, opensAt, closesAt }) => ({ weekday, opensAt, closesAt }))).toEqual([
      { weekday: 3, opensAt: "10:00", closesAt: "14:00" },
    ]);
  });

  it("staff no cambia horarios (403)", async () => {
    const { staff, base, branchId } = await setup();
    await expectError(
      await callApi("PUT", `${base}/branches/${branchId}/hours`, {
        cookie: staff.cookie,
        body: { ranges: [] },
      }),
      403,
      "FORBIDDEN",
    );
  });

  it("otra organización → 404 por las dos vías", async () => {
    const { org, branchId } = await setup();
    const { intruder, orgId } = await intruderOrg();
    await expectNotFoundForOtherTenant({
      intruder,
      method: "PUT",
      body: { ranges: [] },
      paths: [
        `/v1/orgs/${org.orgId}/branches/${branchId}/hours`,
        `/v1/orgs/${orgId}/branches/${branchId}/hours`,
      ],
    });
  });
});

describe("suscripción suspendida", () => {
  it("lee sucursales pero no las edita (403)", async () => {
    const owner = await createUser();
    const org = await createOrg({ ownerId: owner.id, status: "suspended" });
    const branchId = await createBranch({ orgId: org.orgId, businessId: org.businessId });
    const base = `/v1/orgs/${org.orgId}`;
    expect(
      (await callApi("GET", `${base}/branches/${branchId}`, { cookie: owner.cookie })).status,
    ).toBe(200);
    await expectError(
      await callApi("PATCH", `${base}/branches/${branchId}`, {
        cookie: owner.cookie,
        body: { version: 1, name: "Otro" },
      }),
      403,
      "FORBIDDEN",
    );
  });
});
