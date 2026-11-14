import { z } from "zod";

// Planes y suscripciones (T14, ADR-007). Los límites viven en la tabla `plans`, no aquí: las
// constantes solo generan los CHECK de `packages/database`.
export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "suspended"] as const;

export const SubscriptionStatus = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

export const PlanLimits = z
  .strictObject({
    maxBranches: z.int().nonnegative(),
    maxProducts: z.int().nonnegative(),
    maxMembers: z.int().nonnegative(),
  })
  .meta({ id: "PlanLimits" });
export type PlanLimits = z.infer<typeof PlanLimits>;

/** Uso actual de lo que limita el plan. `products` llega con el catálogo (T16). */
export const PlanUsage = z
  .strictObject({
    branches: z.int().nonnegative(),
    members: z.int().nonnegative(),
  })
  .meta({ id: "PlanUsage" });
export type PlanUsage = z.infer<typeof PlanUsage>;

export const SubscriptionDto = z
  .strictObject({
    plan: z.strictObject({ id: z.string(), name: z.string() }),
    status: SubscriptionStatus,
    /** Fin del periodo actual (ISO 8601); `null` mientras no haya cobro. */
    currentPeriodEnd: z.iso.datetime().nullable(),
    limits: PlanLimits,
    usage: PlanUsage,
  })
  .meta({ id: "SubscriptionDto" });
export type SubscriptionDto = z.infer<typeof SubscriptionDto>;
