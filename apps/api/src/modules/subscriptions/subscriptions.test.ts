import { ErrorResponse, SubscriptionDto } from "@menu-max/contracts";
import { plans, subscriptions } from "@menu-max/database";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  addMember,
  createBranch,
  createOrg,
  createPlan,
  createUser,
} from "../../../test/factories";
import { callApi, expectNotFoundForOtherTenant } from "../../../test/isolation";
import { getEnv } from "../../env";
import { createDb } from "../../infrastructure/db";
import { SUSPENDED_MESSAGE } from "../../shared/authz/policies";
import { AppError } from "../../shared/errors";
import { newId } from "../../shared/ids";
import { loadTenant } from "../organizations/organizations.service";
import { assertFeature, assertWithinLimit } from "./limits";

const db = () => createDb(getEnv(env));

async function expectError(response: Response, status: number, code: ErrorResponse["code"]) {
  expect(response.status).toBe(status);
  const body = ErrorResponse.parse(await response.json());
  expect(body.code).toBe(code);
  return body;
}

async function tenantOf(orgId: string, userId: string) {
  const tenant = await loadTenant(db(), orgId, userId, "prueba");
  if (!tenant) throw new Error("Sin membresía");
  return tenant;
}

describe("plans (migración)", () => {
  it("siembra free y pro activos", async () => {
    const rows = await db().select().from(plans);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "free", active: true }),
        expect.objectContaining({ id: "pro", active: true }),
      ]),
    );
  });
});

describe("requireMembership carga el plan", () => {
  it("deja en el tenant el plan, el estado, los límites y las capacidades de la tabla plans", async () => {
    const planId = await createPlan({
      maxBranches: 2,
      maxProducts: 7,
      maxMembers: 4,
      customTheme: true,
      removeBranding: false,
    });
    const owner = await createUser();
    const org = await createOrg({ ownerId: owner.id, planId, status: "trialing" });
    expect((await tenantOf(org.orgId, owner.id)).plan).toEqual({
      id: planId,
      status: "trialing",
      limits: { maxBranches: 2, maxProducts: 7, maxMembers: 4 },
      features: { customTheme: true, removeBranding: false },
    });
  });

  it("una organización sin suscripción responde 500 sin detalles", async () => {
    const owner = await createUser();
    const org = await createOrg({ ownerId: owner.id });
    await db().delete(subscriptions).where(eq(subscriptions.organizationId, org.orgId));
    const error = await expectError(
      await callApi("GET", `/v1/orgs/${org.orgId}`, { cookie: owner.cookie }),
      500,
      "INTERNAL",
    );
    expect(error.message).not.toContain("suscripción");
  });
});

describe("assertFeature", () => {
  it("permite una capacidad activa en el plan", async () => {
    const owner = await createUser();
    const org = await createOrg({
      ownerId: owner.id,
      planId: await createPlan({ customTheme: true, removeBranding: true }),
    });
    const tenant = await tenantOf(org.orgId, owner.id);
    expect(() => assertFeature({ tenant }, "customTheme")).not.toThrow();
    expect(() => assertFeature({ tenant }, "removeBranding")).not.toThrow();
  });

  it("lanza PLAN_LIMIT_REACHED con mensaje accionable sin la capacidad", async () => {
    const owner = await createUser();
    const org = await createOrg({ ownerId: owner.id, planId: await createPlan() });
    const tenant = await tenantOf(org.orgId, owner.id);
    const error = (() => {
      try {
        assertFeature({ tenant }, "customTheme");
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "PLAN_LIMIT_REACHED",
      message: "La personalización de marca está disponible en Pro. Cambia de plan para usarla.",
    });
    expect(() => assertFeature({ tenant }, "removeBranding")).toThrow(AppError);
  });
});

describe("assertWithinLimit", () => {
  it("permite hasta el límite de sucursales y falla en la siguiente", async () => {
    const owner = await createUser();
    const org = await createOrg({
      ownerId: owner.id,
      planId: await createPlan({ maxBranches: 2 }),
    });
    const deps = async () => ({ db: db(), tenant: await tenantOf(org.orgId, owner.id) });

    await assertWithinLimit(await deps(), "branches");
    await createBranch({ orgId: org.orgId, businessId: org.businessId });
    await assertWithinLimit(await deps(), "branches");
    await createBranch({ orgId: org.orgId, businessId: org.businessId });

    const error = await assertWithinLimit(await deps(), "branches").catch((caught) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "PLAN_LIMIT_REACHED",
      message: "Tu plan permite 2 sucursales. Cambia de plan para agregar más.",
    });
  });

  it("cuenta solo miembros activos y usa el singular con límite 1", async () => {
    const owner = await createUser();
    const org = await createOrg({ ownerId: owner.id, planId: await createPlan({ maxMembers: 2 }) });
    await addMember({
      orgId: org.orgId,
      userId: (await createUser()).id,
      role: "admin",
      status: "removed",
    });
    const deps = async () => ({ db: db(), tenant: await tenantOf(org.orgId, owner.id) });

    await assertWithinLimit(await deps(), "members");
    await addMember({ orgId: org.orgId, userId: (await createUser()).id, role: "admin" });
    await expect(assertWithinLimit(await deps(), "members")).rejects.toMatchObject({
      code: "PLAN_LIMIT_REACHED",
      message: "Tu plan permite 2 miembros. Cambia de plan para agregar más.",
    });

    const solo = await createUser();
    const soloOrg = await createOrg({
      ownerId: solo.id,
      planId: await createPlan({ maxBranches: 1 }),
    });
    await createBranch({ orgId: soloOrg.orgId, businessId: soloOrg.businessId });
    await expect(
      assertWithinLimit({ db: db(), tenant: await tenantOf(soloOrg.orgId, solo.id) }, "branches"),
    ).rejects.toMatchObject({
      message: "Tu plan permite 1 sucursal. Cambia de plan para agregar más.",
    });
  });
});

async function suspendedScenario() {
  const owner = await createUser();
  const org = await createOrg({ ownerId: owner.id, status: "suspended" });
  const branchId = await createBranch({ orgId: org.orgId, businessId: org.businessId });
  const staff = await createUser();
  const staffMemberId = await addMember({
    orgId: org.orgId,
    userId: staff.id,
    role: "staff",
    branchIds: [branchId],
  });
  return { owner, org, branchId, staffMemberId, base: `/v1/orgs/${org.orgId}` };
}

describe("Suscripción suspendida", () => {
  it("permite las lecturas privadas", async () => {
    const { owner, base } = await suspendedScenario();
    const paths = [base, `${base}/members`, `${base}/invitations`, `${base}/subscription`];
    await Promise.all(
      paths.map(async (path) => {
        const response = await callApi("GET", path, { cookie: owner.cookie });
        expect(response.status, path).toBe(200);
      }),
    );
  });

  it("bloquea POST, PATCH y DELETE privados con 403 y un mensaje claro", async () => {
    const { owner, base, branchId, staffMemberId } = await suspendedScenario();
    const writes = [
      [
        "POST",
        `${base}/invitations`,
        { email: "ana@example.com", role: "staff", branchIds: [branchId] },
      ],
      ["PATCH", `${base}/members/${staffMemberId}`, { role: "admin" }],
      ["DELETE", `${base}/members/${staffMemberId}`, undefined],
      ["DELETE", `${base}/invitations/${newId()}`, undefined],
    ] as const;
    await Promise.all(
      writes.map(async ([method, path, body]) => {
        const error = await expectError(
          await callApi(method, path, { cookie: owner.cookie, body }),
          403,
          "FORBIDDEN",
        );
        expect(error.message, `${method} ${path}`).toBe(SUSPENDED_MESSAGE);
      }),
    );
  });

  it("past_due y trialing siguen operando", async () => {
    const statuses = ["past_due", "trialing"] as const;
    await Promise.all(
      statuses.map(async (status) => {
        const owner = await createUser();
        const org = await createOrg({ ownerId: owner.id, status });
        const response = await callApi("DELETE", `/v1/orgs/${org.orgId}/invitations/${newId()}`, {
          cookie: owner.cookie,
        });
        // Pasa la suspensión y llega al servicio: la invitación no existe.
        await expectError(response, 404, "NOT_FOUND");
      }),
    );
  });
});

async function subscriptionScenario() {
  const planId = await createPlan({
    maxBranches: 3,
    maxProducts: 50,
    maxMembers: 6,
    customTheme: true,
    removeBranding: false,
  });
  const owner = await createUser();
  const org = await createOrg({ ownerId: owner.id, planId });
  const branchId = await createBranch({ orgId: org.orgId, businessId: org.businessId });
  const admin = await createUser();
  await addMember({ orgId: org.orgId, userId: admin.id, role: "admin" });
  const staff = await createUser();
  await addMember({ orgId: org.orgId, userId: staff.id, role: "staff", branchIds: [branchId] });
  return { planId, owner, admin, staff, org, path: `/v1/orgs/${org.orgId}/subscription` };
}

describe("GET /v1/orgs/:orgId/subscription", () => {
  it("el dueño ve plan, estado, límites y uso actual", async () => {
    const { planId, owner, path } = await subscriptionScenario();
    const response = await callApi("GET", path, { cookie: owner.cookie });
    expect(response.status).toBe(200);
    expect(SubscriptionDto.parse(await response.json())).toEqual({
      plan: { id: planId, name: "Plan de prueba" },
      status: "active",
      currentPeriodEnd: null,
      limits: { maxBranches: 3, maxProducts: 50, maxMembers: 6 },
      features: { customTheme: true, removeBranding: false },
      usage: { branches: 1, products: 0, members: 3 },
    });
  });

  it("devuelve el fin del periodo cuando existe", async () => {
    const { owner, org, path } = await subscriptionScenario();
    const end = new Date("2026-12-01T06:00:00.000Z");
    await db()
      .update(subscriptions)
      .set({ currentPeriodEnd: end })
      .where(eq(subscriptions.organizationId, org.orgId));
    const response = await callApi("GET", path, { cookie: owner.cookie });
    expect(SubscriptionDto.parse(await response.json()).currentPeriodEnd).toBe(end.toISOString());
  });

  it("responde 403 a admin y staff", async () => {
    const { admin, staff, path } = await subscriptionScenario();
    await Promise.all(
      [admin, staff].map(async (member) =>
        expectError(await callApi("GET", path, { cookie: member.cookie }), 403, "FORBIDDEN"),
      ),
    );
  });

  it("responde 401 sin sesión", async () => {
    const { path } = await subscriptionScenario();
    await expectError(await callApi("GET", path), 401, "AUTH_REQUIRED");
  });

  it("responde 404 al dueño de otra organización", async () => {
    const { org } = await subscriptionScenario();
    const intruder = await createUser();
    const other = await createOrg({ ownerId: intruder.id });
    await expectNotFoundForOtherTenant({
      intruder,
      paths: [`/v1/orgs/${org.orgId}/subscription`],
    });
    // Desde su propia organización solo ve su suscripción, no la de A.
    const own = await callApi("GET", `/v1/orgs/${other.orgId}/subscription`, {
      cookie: intruder.cookie,
    });
    expect(SubscriptionDto.parse(await own.json()).usage).toEqual({
      branches: 0,
      products: 0,
      members: 1,
    });
  });
});
