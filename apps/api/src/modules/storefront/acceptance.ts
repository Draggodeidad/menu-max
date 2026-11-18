// ¿El menú recibe pedidos de comensales? (T18, ADR-008). Función pura, sin I/O: la usan la
// lectura pública y, en T21, el pedido público.
import {
  UNVERIFIED_GRACE_DAYS,
  type MenuStatus,
  type NotAcceptingReason,
  type SubscriptionStatus,
} from "@menu-max/contracts";
import { isOpen, type HoursRange } from "../businesses/hours";

export type AcceptanceMenu = { status: MenuStatus };
/**
 * `hasVerifiedOwner`: algún `owner` activo de la organización tiene el correo verificado.
 * `createdAt`: alta de la organización, inicio del periodo de gracia (ADR-008).
 */
export type AcceptanceOrg = {
  hasVerifiedOwner: boolean;
  subscriptionStatus: SubscriptionStatus;
  createdAt: Date;
};
export type AcceptanceBranch = { hours: readonly HoursRange[]; timezone: string };

export type Acceptance =
  | { acceptingOrders: true; reason: null }
  | { acceptingOrders: false; reason: NotAcceptingReason };

function reject(reason: NotAcceptingReason): Acceptance {
  return { acceptingOrders: false, reason };
}

const GRACE_MS = UNVERIFIED_GRACE_DAYS * 24 * 60 * 60 * 1000;

/**
 * ¿Venció el periodo de gracia (ADR-008)? Sin dueño verificado y con 21 días o más desde el alta
 * de la organización. Al verificarse un dueño deja de estar vencido, sin importar la fecha.
 */
export function graceExpired(
  org: Pick<AcceptanceOrg, "hasVerifiedOwner" | "createdAt">,
  now: Date,
): boolean {
  return !org.hasVerifiedOwner && now.getTime() - org.createdAt.getTime() >= GRACE_MS;
}

/**
 * Publicado ∧ algún dueño con correo verificado ∧ suscripción no suspendida ∧ sucursal abierta.
 * Con varios motivos, devuelve el primero en este orden: `unpublished`, `suspended`, `inactive`
 * (sin dueño verificado y con la gracia de ADR-008 vencida), `unverified`, `closed`.
 */
export function acceptingOrders(
  menu: AcceptanceMenu,
  org: AcceptanceOrg,
  branch: AcceptanceBranch,
  now: Date,
): Acceptance {
  if (menu.status !== "published") return reject("unpublished");
  if (org.subscriptionStatus === "suspended") return reject("suspended");
  if (graceExpired(org, now)) return reject("inactive");
  if (!org.hasVerifiedOwner) return reject("unverified");
  if (!isOpen(branch.hours, branch.timezone, now)) return reject("closed");
  return { acceptingOrders: true, reason: null };
}
