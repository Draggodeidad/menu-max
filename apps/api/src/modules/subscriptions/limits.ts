import type { PlanFeatures, PlanLimits } from "@menu-max/contracts";
import type { Db } from "../../infrastructure/db";
import { AppError } from "../../shared/errors";
import type { TenantContext } from "../../types";
import { countResource, type LimitedResource } from "./subscriptions.repository";

export type { LimitedResource };

export type LimitDeps = { db: Db; tenant: TenantContext };

const LIMIT_KEY = {
  branches: "maxBranches",
  members: "maxMembers",
} as const satisfies Record<LimitedResource, keyof PlanLimits>;

const NOUNS = {
  branches: ["sucursal", "sucursales"],
  members: ["miembro", "miembros"],
} as const satisfies Record<LimitedResource, readonly [string, string]>;

/** `PLAN_LIMIT_REACHED` con el límite y qué hacer: "Tu plan permite 1 sucursal. …". */
export function planLimitError(resource: LimitedResource, limit: number) {
  const [singular, plural] = NOUNS[resource];
  return new AppError(
    "PLAN_LIMIT_REACHED",
    `Tu plan permite ${limit} ${limit === 1 ? singular : plural}. Cambia de plan para agregar más.`,
  );
}

/**
 * Lanza `PLAN_LIMIT_REACHED` si agregar uno más de `resource` supera el plan del tenant. El
 * límite sale de `tenant.plan` (tabla `plans`, cargada por `requireMembership`); el uso se cuenta
 * en D1. Llámalo antes de escribir.
 */
export async function assertWithinLimit(deps: LimitDeps, resource: LimitedResource) {
  const limit = deps.tenant.plan.limits[LIMIT_KEY[resource]];
  const used = await countResource(deps.db, deps.tenant, resource);
  if (used >= limit) throw planLimitError(resource, limit);
}

export type PlanFeature = keyof PlanFeatures;

const FEATURE_MESSAGE = {
  customTheme: "La personalización de marca está disponible en Pro. Cambia de plan para usarla.",
  removeBranding:
    "Quitar el sello de MenusMax está disponible en Pro. Cambia de plan para quitarlo.",
} as const satisfies Record<PlanFeature, string>;

/**
 * Lanza `PLAN_LIMIT_REACHED` si el plan del tenant no incluye la capacidad. Lee `tenant.plan`
 * (tabla `plans`, cargada por `requireMembership`); sin consulta extra. Llámalo antes de escribir.
 */
export function assertFeature(deps: { tenant: TenantContext }, feature: PlanFeature) {
  if (deps.tenant.plan.features[feature]) return;
  throw new AppError("PLAN_LIMIT_REACHED", FEATURE_MESSAGE[feature]);
}
