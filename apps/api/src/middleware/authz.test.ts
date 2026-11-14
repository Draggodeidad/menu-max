import { ErrorResponse } from "@menu-max/contracts";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { addMember, createOrg, createUser } from "../../test/factories";
import { createApp } from "../app";
import { getEnv } from "../env";
import { notFound, onError } from "../shared/errors";
import type { AppEnv, TenantEnv } from "../types";
import { requirePermission, requireVerifiedEmail } from "./authz";
import { requestId } from "./request-id";
import { requireAuth } from "./require-auth";
import { session } from "./session";
import { requireMembership } from "./tenant";

/** App mínima con las guardas reales, en el orden de `apps/api/AGENTS.md §7`. */
function guardedApp() {
  const orgScoped = new Hono<TenantEnv>()
    .use(requireAuth, requireMembership())
    .post("/catalog", requirePermission("catalog:write"), (c) => c.json({ ok: true }))
    .post("/invitations", requireVerifiedEmail(), requirePermission("members:manage"), (c) =>
      c.json({ ok: true }),
    );
  const app = new Hono<AppEnv>();
  app.onError(onError);
  app.notFound(notFound);
  app.use("*", requestId, session);
  app.route("/v1/orgs/:orgId", orgScoped);
  return (path: string, cookie: string) =>
    app.request(
      `/v1/orgs/${path}`,
      { method: "POST", headers: { cookie } },
      getEnv(env),
      createExecutionContext(),
    );
}

async function expectError(response: Response, status: number, code: ErrorResponse["code"]) {
  expect(response.status).toBe(status);
  expect(ErrorResponse.parse(await response.json()).code).toBe(code);
}

describe("requirePermission", () => {
  it("expone el permiso que exige como marca para la prueba de guardas", () => {
    expect(requirePermission("orders:read").permission).toBe("orders:read");
  });

  it("deja pasar a un rol con el permiso", async () => {
    const owner = await createUser();
    const org = await createOrg({ ownerId: owner.id });
    const admin = await createUser();
    await addMember({ orgId: org.orgId, userId: admin.id, role: "admin" });
    const request = guardedApp();
    expect((await request(`${org.orgId}/catalog`, owner.cookie)).status).toBe(200);
    expect((await request(`${org.orgId}/catalog`, admin.cookie)).status).toBe(200);
  });

  it("responde 403 FORBIDDEN a un rol sin el permiso dentro de su organización", async () => {
    const owner = await createUser();
    const org = await createOrg({ ownerId: owner.id });
    const staff = await createUser();
    await addMember({ orgId: org.orgId, userId: staff.id, role: "staff" });
    await expectError(await guardedApp()(`${org.orgId}/catalog`, staff.cookie), 403, "FORBIDDEN");
  });

  it("responde 404 y no 403 a quien no es miembro, aunque su rol tendría el permiso", async () => {
    const owner = await createUser();
    const org = await createOrg({ ownerId: owner.id });
    const otherOwner = await createUser();
    await createOrg({ ownerId: otherOwner.id });
    await expectError(
      await guardedApp()(`${org.orgId}/catalog`, otherOwner.cookie),
      404,
      "NOT_FOUND",
    );
  });
});

describe("requireVerifiedEmail", () => {
  it("responde 403 EMAIL_NOT_VERIFIED a un usuario sin verificar", async () => {
    const owner = await createUser({ emailVerified: false });
    const org = await createOrg({ ownerId: owner.id });
    await expectError(
      await guardedApp()(`${org.orgId}/invitations`, owner.cookie),
      403,
      "EMAIL_NOT_VERIFIED",
    );
  });

  it("deja pasar a un usuario verificado", async () => {
    const owner = await createUser({ emailVerified: true });
    const org = await createOrg({ ownerId: owner.id });
    expect((await guardedApp()(`${org.orgId}/invitations`, owner.cookie)).status).toBe(200);
  });
});

// Hono envuelve el handler al montar una sub-app con `onError` propio; el original queda aquí.
const COMPOSED_HANDLER = "__COMPOSED_HANDLER";

function hasPermissionMark(handler: unknown): boolean {
  if (typeof handler !== "function") return false;
  if (typeof (handler as { permission?: unknown }).permission === "string") return true;
  return hasPermissionMark((handler as unknown as Record<string, unknown>)[COMPOSED_HANDLER]);
}

/**
 * Combinaciones método + ruta bajo `/v1/orgs/` sin ningún handler marcado por
 * `requirePermission`. Las entradas `ALL` con ruta `…/*` son middlewares registrados con `use`
 * (`requireAuth`, `requireMembership`) y no cuentan como rutas.
 */
function findUnguardedRoutes(app: Hono<AppEnv>) {
  const routes = new Map<string, boolean>();
  for (const route of app.routes) {
    if (!route.path.startsWith("/v1/orgs/")) continue;
    if (route.method === "ALL" && route.path.endsWith("/*")) continue;
    const key = `${route.method} ${route.path}`;
    routes.set(key, (routes.get(key) ?? false) || hasPermissionMark(route.handler));
  }
  return { checked: [...routes.keys()], unguarded: [...routes].filter(([, ok]) => !ok) };
}

describe("Prueba de guardas", () => {
  // Lista de excepciones vacía a propósito: toda ruta privada declara su permiso.
  it("toda ruta bajo /v1/orgs/ declara requirePermission", () => {
    const { checked, unguarded } = findUnguardedRoutes(createApp("production"));
    expect(checked).toContain("GET /v1/orgs/:orgId");
    expect(unguarded).toEqual([]);
  });

  it("detecta una ruta privada registrada sin requirePermission", () => {
    const app = createApp("production");
    const temporary = new Hono<TenantEnv>()
      .use(requireAuth, requireMembership())
      .get("/sin-guarda", (c) => c.json({ ok: true }))
      .delete("/con-guarda", requirePermission("catalog:write"), (c) => c.json({ ok: true }));
    app.route("/v1/orgs/:orgId", temporary);

    const { unguarded } = findUnguardedRoutes(app);
    expect(unguarded.map(([key]) => key)).toEqual(["GET /v1/orgs/:orgId/sin-guarda"]);
  });

  it("encuentra la marca aunque Hono envuelva el handler de una sub-app con onError", () => {
    const app = new Hono<AppEnv>();
    const withErrorHandler = new Hono<TenantEnv>().get("/x", requirePermission("orders:read"));
    withErrorHandler.onError((error) => {
      throw error;
    });
    app.route("/v1/orgs/:orgId", withErrorHandler);
    expect(findUnguardedRoutes(app).unguarded).toEqual([]);
  });
});
