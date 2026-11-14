// Políticas ABAC (ADR-007): funciones puras, sin I/O. El servicio carga el recurso, construye la
// vista mínima, llama a la política con `assertAllowed` y solo después escribe.
import type { MemberRole } from "@menu-max/contracts";
import type { TenantContext } from "../../types";
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
