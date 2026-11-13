import { ErrorResponse, MeDto, OrganizationDto } from "@menu-max/contracts";
import { branches, memberBranches, organizationMembers } from "@menu-max/database";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { addMember, createBranch, createOrg, createUser } from "../../../test/factories";
import { getEnv } from "../../env";
import worker from "../../index";
import { createDb } from "../../infrastructure/db";
import { requestId } from "../../middleware/request-id";
import { requireAuth } from "../../middleware/require-auth";
import { session } from "../../middleware/session";
import { requireBranch, requireMembership } from "../../middleware/tenant";
import { notFound, onError } from "../../shared/errors";
import { newId } from "../../shared/ids";
import type { AppEnv, TenantEnv } from "../../types";

function randomIp() {
  const [a, b] = crypto.randomUUID().split("-");
  return `2001:db8::${a?.slice(0, 4)}:${b}`;
}

function get(path: string, cookie?: string) {
  const bindings = getEnv(env);
  const headers = new Headers({
    "x-mm-internal": bindings.INTERNAL_TOKEN,
    "x-client-ip": randomIp(),
  });
  if (cookie) headers.set("cookie", cookie);
  return worker.fetch(
    new Request(`https://api.internal/v1/${path}`, { headers }),
    bindings,
    createExecutionContext(),
  );
}

async function expectError(response: Response, status: number, code: ErrorResponse["code"]) {
  expect(response.status).toBe(status);
  expect(ErrorResponse.parse(await response.json()).code).toBe(code);
}

/** Escenario base: una organización con dueño, admin, staff con una sucursal y otra sucursal. */
async function scenario() {
  const owner = await createUser();
  const org = await createOrg({ ownerId: owner.id, name: "Tacos El Güero" });
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
  return { owner, org, branchA, branchB, admin, adminMemberId, staff, staffMemberId };
}

describe("GET /v1/orgs/:orgId", () => {
  it("responde la organización y el rol a cada miembro activo", async () => {
    const { owner, admin, staff, org } = await scenario();
    const members = [
      [owner, "owner"],
      [admin, "admin"],
      [staff, "staff"],
    ] as const;
    const responses = await Promise.all(
      members.map(([user]) => get(`orgs/${org.orgId}`, user.cookie)),
    );
    const bodies = await Promise.all(
      responses.map((response) => {
        expect(response.status).toBe(200);
        return response.json();
      }),
    );
    expect(bodies.map((body) => OrganizationDto.parse(body))).toEqual(
      members.map(([, role]) => ({ id: org.orgId, name: "Tacos El Güero", role })),
    );
  });

  it("responde 401 sin sesión", async () => {
    const { org } = await scenario();
    await expectError(await get(`orgs/${org.orgId}`), 401, "AUTH_REQUIRED");
  });

  it("responde 404 a un usuario sin membresía", async () => {
    const { org } = await scenario();
    const stranger = await createUser();
    await expectError(await get(`orgs/${org.orgId}`, stranger.cookie), 404, "NOT_FOUND");
  });

  it("responde 404 a un miembro removido", async () => {
    const { org } = await scenario();
    const removed = await createUser();
    await addMember({ orgId: org.orgId, userId: removed.id, role: "admin", status: "removed" });
    await expectError(await get(`orgs/${org.orgId}`, removed.cookie), 404, "NOT_FOUND");
  });

  it("responde 404 al dueño de otra organización con el id real de la primera", async () => {
    const { org } = await scenario();
    const other = await scenario();
    await expectError(await get(`orgs/${org.orgId}`, other.owner.cookie), 404, "NOT_FOUND");
  });

  it("responde 404 con un id inexistente o mal formado", async () => {
    const { owner } = await scenario();
    await expectError(await get(`orgs/${newId()}`, owner.cookie), 404, "NOT_FOUND");
    await expectError(await get("orgs/no-es-un-id", owner.cookie), 404, "NOT_FOUND");
  });
});

/** App mínima con las guardas reales para probar el contexto y `requireBranch`. */
function guardedApp() {
  const orgScoped = new Hono<TenantEnv>()
    .use(requireAuth, requireMembership())
    .get("/tenant", (c) => c.json(c.var.tenant))
    .get("/branches/:branchId", requireBranch(), (c) => c.json({ ok: true }));
  const app = new Hono<AppEnv>();
  app.onError(onError);
  app.notFound(notFound);
  app.use("*", requestId, session);
  app.route("/v1/orgs/:orgId", orgScoped);
  return (path: string, cookie: string) =>
    app.request(`/v1/orgs/${path}`, { headers: { cookie } }, getEnv(env), createExecutionContext());
}

describe("requireMembership", () => {
  it("deja el tenant con las sucursales asignadas del miembro", async () => {
    const { owner, staff, org, branchA, staffMemberId } = await scenario();
    const request = guardedApp();

    const asStaff = await request(`${org.orgId}/tenant`, staff.cookie);
    expect(await asStaff.json()).toEqual({
      orgId: org.orgId,
      memberId: staffMemberId,
      role: "staff",
      branchIds: [branchA],
    });

    // `owner` y `admin` no tienen filas en `member_branches`.
    const asOwner = await request(`${org.orgId}/tenant`, owner.cookie);
    expect(await asOwner.json()).toEqual({
      orgId: org.orgId,
      memberId: org.ownerMemberId,
      role: "owner",
      branchIds: [],
    });
  });

  it("no toma sucursales de la membresía removida de otra organización", async () => {
    const { staff, org, branchA } = await scenario();
    const other = await scenario();
    await addMember({
      orgId: other.org.orgId,
      userId: staff.id,
      role: "staff",
      status: "removed",
      branchIds: [other.branchA],
    });
    const response = await guardedApp()(`${org.orgId}/tenant`, staff.cookie);
    expect((await response.json<{ branchIds: string[] }>()).branchIds).toEqual([branchA]);
    await expectError(
      await guardedApp()(`${other.org.orgId}/tenant`, staff.cookie),
      404,
      "NOT_FOUND",
    );
  });
});

describe("requireBranch", () => {
  it("deja pasar una sucursal de la organización", async () => {
    const { owner, org, branchB } = await scenario();
    const response = await guardedApp()(`${org.orgId}/branches/${branchB}`, owner.cookie);
    expect(response.status).toBe(200);
  });

  it("responde 404 con una sucursal de otra organización, inexistente o mal formada", async () => {
    const { owner, org } = await scenario();
    const other = await scenario();
    const request = guardedApp();
    await Promise.all(
      [other.branchA, newId(), "no-es-un-id"].map(async (branchId) =>
        expectError(
          await request(`${org.orgId}/branches/${branchId}`, owner.cookie),
          404,
          "NOT_FOUND",
        ),
      ),
    );
  });
});

describe("GET /v1/me", () => {
  it("lista solo las membresías activas del usuario", async () => {
    const user = await createUser();
    const active = await scenario();
    const removed = await scenario();
    await scenario(); // Organización sin relación con el usuario.
    await addMember({ orgId: active.org.orgId, userId: user.id, role: "admin" });
    await addMember({
      orgId: removed.org.orgId,
      userId: user.id,
      role: "staff",
      status: "removed",
    });

    const response = await get("me", user.cookie);
    expect(response.status).toBe(200);
    const me = MeDto.parse(await response.json());
    expect(me.user.id).toBe(user.id);
    expect(me.memberships).toEqual([
      { orgId: active.org.orgId, orgName: "Tacos El Güero", role: "admin" },
    ]);
  });

  it("devuelve una lista vacía a un usuario sin organizaciones", async () => {
    const user = await createUser();
    const response = await get("me", user.cookie);
    expect(MeDto.parse(await response.json()).memberships).toEqual([]);
  });
});

describe("Integridad del esquema de tenancy", () => {
  it("rechaza una sucursal con el negocio de otra organización", async () => {
    const { org } = await scenario();
    const other = await scenario();
    const db = createDb(getEnv(env));
    await expect(
      db.insert(branches).values({
        id: newId(),
        organizationId: org.orgId,
        businessId: other.org.businessId,
        name: "Cruzada",
      }),
    ).rejects.toThrow();
  });

  it("rechaza asignar a un miembro una sucursal de otra organización", async () => {
    const { org, staffMemberId } = await scenario();
    const other = await scenario();
    const db = createDb(getEnv(env));
    await expect(
      db.insert(memberBranches).values({
        organizationId: org.orgId,
        memberId: staffMemberId,
        branchId: other.branchA,
      }),
    ).rejects.toThrow();
  });

  it("rechaza roles y estados fuera del catálogo y membresías duplicadas", async () => {
    const { org, admin } = await scenario();
    const db = createDb(getEnv(env));
    const stranger = await createUser();
    const insertMember = (values: Record<string, string>) =>
      db.insert(organizationMembers).values({
        id: newId(),
        organizationId: org.orgId,
        userId: stranger.id,
        role: "staff",
        ...values,
      } as typeof organizationMembers.$inferInsert);
    await expect(insertMember({ role: "superadmin" })).rejects.toThrow();
    await expect(insertMember({ status: "suspended" })).rejects.toThrow();
    await expect(insertMember({ userId: admin.id })).rejects.toThrow();
  });

  it("rechaza filas de tenant con una organización inexistente", async () => {
    const db = createDb(getEnv(env));
    const user = await createUser();
    await expect(
      db.insert(organizationMembers).values({
        id: newId(),
        organizationId: newId(),
        userId: user.id,
        role: "owner",
      }),
    ).rejects.toThrow();
  });
});
