import type { MemberRole } from "@menu-max/contracts";
import type { Env } from "./env";
import type { AuthSession, AuthUser } from "./modules/auth/auth";

export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    clientIp: string | undefined;
    userAgent: string | undefined;
    user: AuthUser | null;
    session: AuthSession | null;
  };
};

export type AuthenticatedEnv = {
  Bindings: Env;
  Variables: AppEnv["Variables"] & { user: AuthUser; session: AuthSession };
};

/**
 * Tenant verificado por `requireMembership` (ADR-006). `branchIds` son las sucursales asignadas
 * en `member_branches`: solo `staff` tiene filas; `owner` y `admin` las operan todas. `plan`
 * llega en T14.
 */
export type TenantContext = {
  orgId: string;
  memberId: string;
  role: MemberRole;
  branchIds: string[];
};

/** Rutas bajo `/v1/orgs/:orgId`: existe `tenant` solo después de `requireMembership`. */
export type TenantEnv = {
  Bindings: Env;
  Variables: AuthenticatedEnv["Variables"] & { tenant: TenantContext };
};
