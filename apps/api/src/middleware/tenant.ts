import { BranchParams, OrgParams } from "@menu-max/contracts";
import { createMiddleware } from "hono/factory";
import { createDb } from "../infrastructure/db";
import { branchBelongsToTenant, loadTenant } from "../modules/organizations/organizations.service";
import { AppError } from "../shared/errors";
import type { TenantEnv } from "../types";

/**
 * Verifica la membresía activa del usuario en `:orgId` y deja `c.var.tenant` (ADR-006).
 * Sin membresía, removida o con un id mal formado → `NOT_FOUND`: la organización no existe
 * para este usuario. Va después de `requireAuth`.
 */
export function requireMembership() {
  return createMiddleware<TenantEnv>(async (c, next) => {
    const user = c.var.user as TenantEnv["Variables"]["user"] | null;
    if (!user) throw new AppError("AUTH_REQUIRED");
    const params = OrgParams.safeParse({ orgId: c.req.param("orgId") });
    if (!params.success) throw new AppError("NOT_FOUND");

    const tenant = await loadTenant(createDb(c.env), params.data.orgId, user.id, c.var.requestId);
    if (!tenant) throw new AppError("NOT_FOUND");
    c.set("tenant", tenant);
    await next();
  });
}

/** Verifica que `:branchId` pertenezca a `tenant.orgId`; si no → `NOT_FOUND`. */
export function requireBranch() {
  return createMiddleware<TenantEnv>(async (c, next) => {
    const params = BranchParams.safeParse({ branchId: c.req.param("branchId") });
    if (!params.success) throw new AppError("NOT_FOUND");
    if (!(await branchBelongsToTenant(createDb(c.env), c.var.tenant, params.data.branchId))) {
      throw new AppError("NOT_FOUND");
    }
    await next();
  });
}
