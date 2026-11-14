import { ErrorResponse, MemberDto, MemberListDto } from "@menu-max/contracts";
import { memberBranches } from "@menu-max/database";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addMember, createBranch, createOrg, createUser } from "../../../test/factories";
import { callApi, expectNotFoundForOtherTenant } from "../../../test/isolation";
import { getEnv } from "../../env";
import { createDb } from "../../infrastructure/db";
import { newId } from "../../shared/ids";

async function expectError(response: Response, status: number, code: ErrorResponse["code"]) {
  expect(response.status).toBe(status);
  const body = ErrorResponse.parse(await response.json());
  expect(body.code).toBe(code);
  return body;
}

/** Organización con dueño, admin, staff (sucursal A) y dos sucursales. */
async function scenario() {
  const owner = await createUser();
  const org = await createOrg({ ownerId: owner.id });
  const branchA = await createBranch({ orgId: org.orgId, businessId: org.businessId });
  const branchB = await createBranch({ orgId: org.orgId, businessId: org.businessId });
  const admin = await createUser();
  const adminMemberId = await addMember({ orgId: org.orgId, userId: admin.id, role: "admin" });
  const staff = await createUser();
  const staffMemberId = await addMember({
    orgId: org.orgId,
    userId: staff.id,
    role: "staff",
    branchIds: [branchA],
  });
  const members = `/v1/orgs/${org.orgId}/members`;
  return {
    owner,
    org,
    branchA,
    branchB,
    admin,
    adminMemberId,
    staff,
    staffMemberId,
    members,
  };
}

function assignedBranches(memberId: string) {
  return createDb(getEnv(env))
    .select({ branchId: memberBranches.branchId })
    .from(memberBranches)
    .where(eq(memberBranches.memberId, memberId));
}

describe("GET /v1/orgs/:orgId/members", () => {
  it("lista a los miembros activos con rol, sucursales y correo completo para el dueño", async () => {
    const s = await scenario();
    const removed = await createUser();
    await addMember({ orgId: s.org.orgId, userId: removed.id, role: "staff", status: "removed" });
    const response = await callApi("GET", s.members, { cookie: s.owner.cookie });
    expect(response.status).toBe(200);
    const list = MemberListDto.parse(await response.json());
    expect(list.nextCursor).toBeNull();
    // Orden por id (UUIDv7): dentro del mismo milisegundo el orden es aleatorio.
    const expected: [string, string, string, string[]][] = [
      [s.org.ownerMemberId, "owner", s.owner.email, []],
      [s.adminMemberId, "admin", s.admin.email, []],
      [s.staffMemberId, "staff", s.staff.email, [s.branchA]],
    ];
    expected.sort((a, b) => a[0].localeCompare(b[0]));
    expect(list.items.map((m) => [m.id, m.role, m.email, m.branchIds])).toEqual(expected);
  });

  it("enmascara los correos cuando consulta un staff", async () => {
    const s = await scenario();
    const response = await callApi("GET", s.members, { cookie: s.staff.cookie });
    const list = MemberListDto.parse(await response.json());
    expect(list.items).toHaveLength(3);
    for (const member of list.items) expect(member.email).toBe("p***@example.com");
  });

  it("pagina por cursor", async () => {
    const s = await scenario();
    const ids = [s.org.ownerMemberId, s.adminMemberId, s.staffMemberId];
    ids.sort();
    const first = MemberListDto.parse(
      await (await callApi("GET", `${s.members}?limit=2`, { cookie: s.owner.cookie })).json(),
    );
    expect(first.items.map((m) => m.id)).toEqual(ids.slice(0, 2));
    expect(first.nextCursor).toBe(ids[1]);
    const second = MemberListDto.parse(
      await (
        await callApi("GET", `${s.members}?limit=2&cursor=${first.nextCursor}`, {
          cookie: s.owner.cookie,
        })
      ).json(),
    );
    expect(second).toEqual({ items: [expect.objectContaining({ id: ids[2] })], nextCursor: null });
  });

  it("rechaza un límite fuera de rango", async () => {
    const s = await scenario();
    const body = await expectError(
      await callApi("GET", `${s.members}?limit=101`, { cookie: s.owner.cookie }),
      400,
      "VALIDATION_FAILED",
    );
    expect(body.fieldErrors).toHaveProperty("limit");
  });

  it("responde 401 sin sesión", async () => {
    const s = await scenario();
    await expectError(await callApi("GET", s.members), 401, "AUTH_REQUIRED");
  });

  it("responde 404 al miembro de otra organización", async () => {
    const s = await scenario();
    const other = await scenario();
    await expectNotFoundForOtherTenant({ paths: [s.members], intruder: other.owner });
  });
});

function patch(path: string, cookie: string | undefined, body: unknown) {
  return callApi("PATCH", path, { cookie, body });
}

describe("PATCH /v1/orgs/:orgId/members/:memberId", () => {
  it("un admin cambia las sucursales de un staff", async () => {
    const s = await scenario();
    const response = await patch(`${s.members}/${s.staffMemberId}`, s.admin.cookie, {
      branchIds: [s.branchB],
    });
    expect(response.status).toBe(200);
    const member = MemberDto.parse(await response.json());
    expect(member).toMatchObject({ id: s.staffMemberId, role: "staff", branchIds: [s.branchB] });
    expect(await assignedBranches(s.staffMemberId)).toEqual([{ branchId: s.branchB }]);
  });

  it("el dueño asciende a un staff a admin y se borran sus sucursales", async () => {
    const s = await scenario();
    const response = await patch(`${s.members}/${s.staffMemberId}`, s.owner.cookie, {
      role: "admin",
    });
    expect(MemberDto.parse(await response.json())).toMatchObject({ role: "admin", branchIds: [] });
    expect(await assignedBranches(s.staffMemberId)).toEqual([]);
  });

  it("al bajar a staff exige sucursales y solo acepta sucursales para staff", async () => {
    const s = await scenario();
    const path = `${s.members}/${s.adminMemberId}`;
    const missing = await expectError(
      await patch(path, s.owner.cookie, { role: "staff" }),
      400,
      "VALIDATION_FAILED",
    );
    expect(missing.fieldErrors).toHaveProperty("branchIds");
    await expectError(
      await patch(path, s.owner.cookie, { branchIds: [s.branchA] }),
      400,
      "VALIDATION_FAILED",
    );
    const ok = await patch(path, s.owner.cookie, { role: "staff", branchIds: [s.branchA] });
    expect(MemberDto.parse(await ok.json())).toMatchObject({
      role: "staff",
      branchIds: [s.branchA],
    });
  });

  it("rechaza sucursales de otra organización con VALIDATION_FAILED", async () => {
    const s = await scenario();
    const other = await scenario();
    const body = await expectError(
      await patch(`${s.members}/${s.staffMemberId}`, s.owner.cookie, {
        branchIds: [other.branchA],
      }),
      400,
      "VALIDATION_FAILED",
    );
    expect(body.fieldErrors).toHaveProperty("branchIds");
    expect(await assignedBranches(s.staffMemberId)).toEqual([{ branchId: s.branchA }]);
  });

  it("rechaza un cuerpo vacío o con llaves desconocidas", async () => {
    const s = await scenario();
    const path = `${s.members}/${s.staffMemberId}`;
    await expectError(await patch(path, s.owner.cookie, {}), 400, "VALIDATION_FAILED");
    await expectError(
      await patch(path, s.owner.cookie, { role: "staff", status: "removed" }),
      400,
      "VALIDATION_FAILED",
    );
  });

  it("un admin no asciende a staff ni modifica a un admin o dueño", async () => {
    const s = await scenario();
    await expectError(
      await patch(`${s.members}/${s.staffMemberId}`, s.admin.cookie, { role: "admin" }),
      403,
      "FORBIDDEN",
    );
    const otherAdmin = await createUser();
    const otherAdminId = await addMember({
      orgId: s.org.orgId,
      userId: otherAdmin.id,
      role: "admin",
    });
    await expectError(
      await patch(`${s.members}/${otherAdminId}`, s.admin.cookie, {
        role: "staff",
        branchIds: [s.branchA],
      }),
      403,
      "FORBIDDEN",
    );
    await expectError(
      await patch(`${s.members}/${s.org.ownerMemberId}`, s.admin.cookie, { role: "admin" }),
      403,
      "FORBIDDEN",
    );
  });

  it("responde 403 a un staff (sin members:manage)", async () => {
    const s = await scenario();
    await expectError(
      await patch(`${s.members}/${s.staffMemberId}`, s.staff.cookie, { branchIds: [s.branchB] }),
      403,
      "FORBIDDEN",
    );
  });

  it("no degrada al último dueño", async () => {
    const s = await scenario();
    await expectError(
      await patch(`${s.members}/${s.org.ownerMemberId}`, s.owner.cookie, { role: "admin" }),
      422,
      "BUSINESS_RULE",
    );
  });

  it("dos dueños que se degradan al mismo tiempo dejan al menos uno", async () => {
    const s = await scenario();
    const second = await createUser();
    const secondId = await addMember({ orgId: s.org.orgId, userId: second.id, role: "owner" });
    const responses = await Promise.all([
      patch(`${s.members}/${secondId}`, s.owner.cookie, { role: "admin" }),
      patch(`${s.members}/${s.org.ownerMemberId}`, second.cookie, { role: "admin" }),
    ]);
    const statuses = responses.map((r) => r.status);
    expect(statuses).toHaveLength(2);
    expect(statuses).toEqual(expect.arrayContaining([200, 422]));
  });

  it("responde 404 con un miembro inexistente, removido o con id mal formado", async () => {
    const s = await scenario();
    const removed = await createUser();
    const removedId = await addMember({
      orgId: s.org.orgId,
      userId: removed.id,
      role: "staff",
      status: "removed",
    });
    await Promise.all(
      [newId(), removedId, "no-es-un-id"].map(async (id) =>
        expectError(
          await patch(`${s.members}/${id}`, s.owner.cookie, { role: "admin" }),
          404,
          "NOT_FOUND",
        ),
      ),
    );
  });

  it("responde 401 sin sesión", async () => {
    const s = await scenario();
    await expectError(
      await patch(`${s.members}/${s.staffMemberId}`, undefined, { role: "admin" }),
      401,
      "AUTH_REQUIRED",
    );
  });

  it("responde 404 entre organizaciones con ids reales", async () => {
    const s = await scenario();
    const other = await scenario();
    await expectNotFoundForOtherTenant({
      method: "PATCH",
      body: { branchIds: [s.branchB] },
      intruder: other.owner,
      paths: [`${s.members}/${s.staffMemberId}`, `${other.members}/${s.staffMemberId}`],
    });
    expect(await assignedBranches(s.staffMemberId)).toEqual([{ branchId: s.branchA }]);
  });
});

describe("DELETE /v1/orgs/:orgId/members/:memberId", () => {
  it("quita a un staff, borra sus sucursales y pierde el acceso", async () => {
    const s = await scenario();
    const response = await callApi("DELETE", `${s.members}/${s.staffMemberId}`, {
      cookie: s.admin.cookie,
    });
    expect(response.status).toBe(204);
    expect(await assignedBranches(s.staffMemberId)).toEqual([]);
    await expectError(
      await callApi("GET", `/v1/orgs/${s.org.orgId}`, { cookie: s.staff.cookie }),
      404,
      "NOT_FOUND",
    );
  });

  it("no quita al último dueño, pero sí a uno de dos", async () => {
    const s = await scenario();
    await expectError(
      await callApi("DELETE", `${s.members}/${s.org.ownerMemberId}`, { cookie: s.owner.cookie }),
      422,
      "BUSINESS_RULE",
    );
    const second = await createUser();
    await addMember({ orgId: s.org.orgId, userId: second.id, role: "owner" });
    const response = await callApi("DELETE", `${s.members}/${s.org.ownerMemberId}`, {
      cookie: second.cookie,
    });
    expect(response.status).toBe(204);
  });

  it("un admin no quita a otro admin y un staff no quita a nadie", async () => {
    const s = await scenario();
    const otherAdmin = await createUser();
    const otherAdminId = await addMember({
      orgId: s.org.orgId,
      userId: otherAdmin.id,
      role: "admin",
    });
    await expectError(
      await callApi("DELETE", `${s.members}/${otherAdminId}`, { cookie: s.admin.cookie }),
      403,
      "FORBIDDEN",
    );
    await expectError(
      await callApi("DELETE", `${s.members}/${s.staffMemberId}`, { cookie: s.staff.cookie }),
      403,
      "FORBIDDEN",
    );
  });

  it("responde 401 sin sesión", async () => {
    const s = await scenario();
    await expectError(
      await callApi("DELETE", `${s.members}/${s.staffMemberId}`),
      401,
      "AUTH_REQUIRED",
    );
  });

  it("responde 404 entre organizaciones con ids reales", async () => {
    const s = await scenario();
    const other = await scenario();
    await expectNotFoundForOtherTenant({
      method: "DELETE",
      intruder: other.owner,
      paths: [`${s.members}/${s.staffMemberId}`, `${other.members}/${s.staffMemberId}`],
    });
    expect(await assignedBranches(s.staffMemberId)).toEqual([{ branchId: s.branchA }]);
  });
});
