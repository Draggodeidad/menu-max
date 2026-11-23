// Políticas ABAC (ADR-007): funciones puras, sin I/O. El servicio carga el recurso, construye la
// vista mínima, llama a la política con `assertAllowed` y solo después escribe.
import {
  ORDER_TRANSITIONS,
  type MemberRole,
  type OrderMode,
  type OrderStatus,
} from "@menu-max/contracts";
import type { TenantContext } from "../../types";
import { hasPermission } from "./permissions";
import { allow, deny, type PolicyResult } from "./result";

type TenantView = Pick<TenantContext, "role" | "branchIds">;

/**
 * `owner` y `admin` operan cualquier sucursal de su organización; `staff`, solo las asignadas.
 * No verifica que la sucursal sea de la organización: eso lo garantizan `requireBranch` y el
 * repositorio, que filtran por `organization_id`. Fuera de alcance → `NOT_FOUND` (no se revela).
 */
export function canAccessBranch(tenant: TenantView, branchId: string): PolicyResult {
  if (tenant.role !== "staff") return allow();
  return tenant.branchIds.includes(branchId) ? allow() : deny("NOT_FOUND");
}

/** Vista mínima del pedido para decidir una transición. */
export type OrderAuthView = {
  orgId: string;
  branchId: string;
  status: OrderStatus;
  mode: OrderMode;
};

export const CANCEL_FORBIDDEN_MESSAGE = "Solo un dueño o administrador puede cancelar un pedido.";

/**
 * Transición del panel (T23, ADR-007): pedido de la organización y de una sucursal del actor,
 * cambio válido para su estado y modalidad, y `cancelled` solo con `orders:cancel`.
 */
export function canTransitionOrder(
  tenant: TenantView & Pick<TenantContext, "orgId">,
  order: OrderAuthView,
  to: OrderStatus,
): PolicyResult {
  if (order.orgId !== tenant.orgId) return deny("NOT_FOUND");
  const branch = canAccessBranch(tenant, order.branchId);
  if (!branch.allowed) return branch;
  if (!ORDER_TRANSITIONS[order.mode][order.status].includes(to)) {
    return deny("INVALID_TRANSITION");
  }
  if (to === "cancelled" && !hasPermission(tenant.role, "orders:cancel")) {
    return deny("FORBIDDEN", CANCEL_FORBIDDEN_MESSAGE);
  }
  return allow();
}

/** Miembro sobre el que se actúa. `activeOwnerCount` cuenta los `owner` activos de la org. */
export type MemberAuthView = { role: MemberRole; activeOwnerCount: number };

export type MemberChange = { action: "remove" } | { action: "update"; role?: MemberRole };

export const LAST_OWNER_MESSAGE =
  "La organización necesita al menos un dueño. Asigna otro dueño antes de continuar.";

/**
 * Reglas fijas de ADR-007:
 * - `staff` no gestiona miembros;
 * - `admin` solo gestiona `staff` y solo puede asignar el rol `staff`;
 * - a un `owner` solo lo modifica otro `owner`;
 * - nunca se elimina ni se degrada al último `owner`.
 */
export function canManageMember(
  tenant: TenantView,
  target: MemberAuthView,
  change: MemberChange,
): PolicyResult {
  const newRole = change.action === "update" ? change.role : undefined;

  if (tenant.role === "staff") return deny("FORBIDDEN");
  if (tenant.role === "admin") {
    if (target.role !== "staff") {
      return deny("FORBIDDEN", "Solo un dueño puede modificar a un dueño o administrador.");
    }
    if (newRole !== undefined && newRole !== "staff") {
      return deny("FORBIDDEN", "Solo un dueño puede asignar el rol de dueño o administrador.");
    }
    return allow();
  }

  const losesOwner =
    target.role === "owner" &&
    (change.action === "remove" || (newRole !== undefined && newRole !== "owner"));
  if (losesOwner && target.activeOwnerCount <= 1) return deny("BUSINESS_RULE", LAST_OWNER_MESSAGE);
  return allow();
}

/**
 * Invitar o revocar una invitación con el rol `role` (ADR-007): `owner` invita cualquier rol,
 * `admin` solo `staff` y `staff` a nadie.
 */
export function canInviteMember(tenant: TenantView, role: MemberRole): PolicyResult {
  if (tenant.role === "owner") return allow();
  if (tenant.role === "admin") {
    return role === "staff"
      ? allow()
      : deny("FORBIDDEN", "Solo un dueño puede invitar a un dueño o administrador.");
  }
  return deny("FORBIDDEN");
}

export const SUSPENDED_MESSAGE =
  "Tu suscripción está suspendida: puedes consultar tu información, pero no hacer cambios.";

/**
 * Escrituras privadas según el estado de la suscripción (T14): con `suspended` solo se permiten
 * lecturas; `trialing`, `active` y `past_due` operan normalmente.
 */
export function canOperate(tenant: Pick<TenantContext, "plan">): PolicyResult {
  return tenant.plan.status === "suspended" ? deny("FORBIDDEN", SUSPENDED_MESSAGE) : allow();
}
