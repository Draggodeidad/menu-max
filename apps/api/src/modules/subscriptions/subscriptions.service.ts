import type { SubscriptionDto } from "@menu-max/contracts";
import type { Db } from "../../infrastructure/db";
import { AppError } from "../../shared/errors";
import { log } from "../../shared/log";
import type { TenantContext } from "../../types";
import {
  findMemberLimit,
  findSubscriptionWithUsage,
  memberSlotAvailable,
} from "./subscriptions.repository";

export type SubscriptionDeps = { db: Db; tenant: TenantContext; requestId: string };

/** Toda organización tiene suscripción desde su alta (T20); si falta, es un dato corrupto. */
export function missingSubscription(requestId: string, orgId: string) {
  log.error("subscription.missing", { requestId, orgId });
  return new AppError("INTERNAL");
}

/** Plan, estado, límites y uso actual de la organización. */
export async function getSubscription(deps: SubscriptionDeps): Promise<SubscriptionDto> {
  const row = await findSubscriptionWithUsage(deps.db, deps.tenant);
  if (!row) throw missingSubscription(deps.requestId, deps.tenant.orgId);
  return {
    plan: { id: row.planId, name: row.planName },
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    limits: {
      maxBranches: row.maxBranches,
      maxProducts: row.maxProducts,
      maxMembers: row.maxMembers,
    },
    features: { customTheme: row.customTheme, removeBranding: row.removeBranding },
    usage: row.usage,
  };
}

export const MEMBER_LIMIT_ON_ACCEPT_MESSAGE =
  "Este equipo ya alcanzó el límite de miembros de su plan. Pide a quien te invitó que libere un lugar o cambie de plan.";

/**
 * Para aceptar una invitación (ruta pública, sin tenant): `PLAN_LIMIT_REACHED` si la
 * organización ya no tiene lugar para otro miembro activo.
 */
export async function assertMemberSlotForInvitation(db: Db, orgId: string, requestId: string) {
  const members = await findMemberLimit(db, orgId);
  if (!members) throw missingSubscription(requestId, orgId);
  if (members.used >= members.limit) {
    throw new AppError("PLAN_LIMIT_REACHED", MEMBER_LIMIT_ON_ACCEPT_MESSAGE);
  }
}

/** Condición SQL para la sentencia que agrega al miembro (cierra la carrera entre aceptaciones). */
export function memberSlotCondition(db: Db, orgId: string) {
  return memberSlotAvailable(db, orgId);
}
