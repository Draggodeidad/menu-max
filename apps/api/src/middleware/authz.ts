import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono";
import { hasPermission, type Permission } from "../shared/authz/permissions";
import { AppError } from "../shared/errors";
import type { AuthenticatedEnv, TenantEnv } from "../types";

/** Middleware marcado con el permiso que exige; la prueba de guardas busca esta marca. */
export type PermissionGuard = MiddlewareHandler<TenantEnv> & { readonly permission: Permission };

/**
 * RBAC por ruta (ADR-007): rol del tenant sin el permiso → `FORBIDDEN`. No toca la base.
 * Va después de `requireAuth` y `requireMembership()`.
 */
export function requirePermission(permission: Permission): PermissionGuard {
  const guard = createMiddleware<TenantEnv>(async (c, next) => {
    if (!hasPermission(c.var.tenant.role, permission)) throw new AppError("FORBIDDEN");
    await next();
  });
  return Object.assign(guard, { permission });
}

/**
 * Acciones que exponen el negocio al público (publicar, WhatsApp, invitar) exigen correo
 * verificado (ADR-008). Va después de `requireAuth`.
 */
export function requireVerifiedEmail() {
  return createMiddleware<AuthenticatedEnv>(async (c, next) => {
    if (!c.var.user.emailVerified) throw new AppError("EMAIL_NOT_VERIFIED");
    await next();
  });
}
