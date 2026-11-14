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

/** Capacidades sí o no del plan (T14b). Se leen de `plans`; ninguna vive en código. */
export const PlanFeatures = z
  .strictObject({
    customTheme: z.boolean(),
    removeBranding: z.boolean(),
  })
  .meta({ id: "PlanFeatures" });
export type PlanFeatures = z.infer<typeof PlanFeatures>;

/** Uso actual de lo que limita el plan. */
export const PlanUsage = z
  .strictObject({
    branches: z.int().nonnegative(),
    /** Productos no borrados de toda la organización (T16). */
    products: z.int().nonnegative(),
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
    features: PlanFeatures,
    usage: PlanUsage,
  })
  .meta({ id: "SubscriptionDto" });
export type SubscriptionDto = z.infer<typeof SubscriptionDto>;
