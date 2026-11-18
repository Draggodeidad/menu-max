// ¿El menú recibe pedidos de comensales? (T18, ADR-008). Función pura, sin I/O: la usan la
// lectura pública y, en T21, el pedido público.
import type { MenuStatus, NotAcceptingReason, SubscriptionStatus } from "@menu-max/contracts";
import { isOpen, type HoursRange } from "../businesses/hours";

export type AcceptanceMenu = { status: MenuStatus };
/** `hasVerifiedOwner`: algún `owner` activo de la organización tiene el correo verificado. */
export type AcceptanceOrg = { hasVerifiedOwner: boolean; subscriptionStatus: SubscriptionStatus };
export type AcceptanceBranch = { hours: readonly HoursRange[]; timezone: string };

export type Acceptance =
  | { acceptingOrders: true; reason: null }
  | { acceptingOrders: false; reason: NotAcceptingReason };

function reject(reason: NotAcceptingReason): Acceptance {
  return { acceptingOrders: false, reason };
}

/**
 * Publicado ∧ algún dueño con correo verificado ∧ suscripción no suspendida ∧ sucursal abierta.
 * Con varios motivos, devuelve el primero en este orden: `unpublished`, `suspended`,
 * `unverified`, `closed`. El periodo de gracia de ADR-008 sigue `Propuesto` y no se aplica.
 */
export function acceptingOrders(
  menu: AcceptanceMenu,
  org: AcceptanceOrg,
  branch: AcceptanceBranch,
  now: Date,
): Acceptance {
  if (menu.status !== "published") return reject("unpublished");
  if (org.subscriptionStatus === "suspended") return reject("suspended");
  if (!org.hasVerifiedOwner) return reject("unverified");
  if (!isOpen(branch.hours, branch.timezone, now)) return reject("closed");
  return { acceptingOrders: true, reason: null };
}
