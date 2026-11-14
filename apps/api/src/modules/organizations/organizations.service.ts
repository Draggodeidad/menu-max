import {
  BRANCHES_ONLY_FOR_STAFF,
  STAFF_BRANCHES_REQUIRED,
  type AcceptInvitationDto,
  type AcceptInvitationInput,
  type CreateInvitationInput,
  type CursorQuery,
  type InvitationDto,
  type InvitationListDto,
  type InvitationPreviewDto,
  type MemberDto,
  type MemberListDto,
  type MemberRole,
  type MembershipDto,
  type OrganizationDto,
  type UpdateMemberInput,
} from "@menu-max/contracts";
import type { Env } from "../../env";
import type { Db } from "../../infrastructure/db";
import { enqueue } from "../../infrastructure/jobs";
import { TURNSTILE_HEADER, verifyTurnstile } from "../../infrastructure/turnstile";
import { canInviteMember, canManageMember, LAST_OWNER_MESSAGE } from "../../shared/authz/policies";
import { assertAllowed } from "../../shared/authz/result";
import { assertDeliverableEmail, normalizeEmail } from "../../shared/email-checks";
import { AppError } from "../../shared/errors";
import { hashToken, newId, newPublicToken } from "../../shared/ids";
import { log } from "../../shared/log";
import { hit } from "../../shared/rate-counters";
import type { TenantContext } from "../../types";
import type { AuthUser } from "../auth/auth";
import {
  ACCOUNT_EXISTS_MESSAGE,
  accountExists,
  createInvitedUser,
  emailVerifiedStatement,
} from "../auth/auth.service";
import { invitationLink } from "../auth/web-links";
import { assertWithinLimit } from "../subscriptions/limits";
import {
  assertMemberSlotForInvitation,
  memberSlotCondition,
  missingSubscription,
} from "../subscriptions/subscriptions.service";
import {
  claimInvitationStatements,
  findActiveMember,
  findActiveMembership,
  findBranch,
  findInvitationByTokenHash,
  findMemberAuthView,
  findMembershipOfUser,
  findOrganization,
  findOrgBranchIds,
  findPendingInvitation,
  insertInvitation,
  invitationClaimed,
  isActiveMemberEmail,
  listActiveMembers,
  listActiveMemberships,
  listPendingInvitations,
  removeMember as removeMemberRow,
  revokeInvitation as revokeInvitationRow,
  updateMember as updateMemberRow,
} from "./organizations.repository";

/**
 * Contexto del tenant, con el plan de la organización (T14), o `null` si el usuario no tiene
 * membresía activa en ella. Una organización sin suscripción es un dato corrupto → `INTERNAL`.
 */
export async function loadTenant(
  db: Db,
  orgId: string,
  userId: string,
  requestId: string,
): Promise<TenantContext | null> {
  const member = await findActiveMembership(db, orgId, userId);
  if (!member) return null;
  const { planId, status, maxBranches, maxProducts, maxMembers, customTheme, removeBranding } =
    member;
  if (
    planId === null ||
    status === null ||
    maxBranches === null ||
    maxProducts === null ||
    maxMembers === null ||
    customTheme === null ||
    removeBranding === null
  ) {
    throw missingSubscription(requestId, orgId);
  }
  return {
    orgId,
    memberId: member.id,
    role: member.role,
    branchIds: member.branchIds,
    plan: {
      id: planId,
      status,
      limits: { maxBranches, maxProducts, maxMembers },
      features: { customTheme, removeBranding },
    },
  };
}

export async function getOrganization(db: Db, tenant: TenantContext): Promise<OrganizationDto> {
  const organization = await findOrganization(db, tenant);
  if (!organization) throw new AppError("NOT_FOUND");
  return { id: organization.id, name: organization.name, role: tenant.role };
}

export async function listMemberships(db: Db, userId: string): Promise<MembershipDto[]> {
  const rows = await listActiveMemberships(db, userId);
  return rows.map((row) => ({ orgId: row.orgId, orgName: row.orgName, role: row.role }));
}

export async function branchBelongsToTenant(db: Db, tenant: TenantContext, branchId: string) {
  return (await findBranch(db, tenant, branchId)) !== undefined;
}

/** Dependencias de un servicio con tenant; las arma `deps(c)` en las rutas. */
export type OrgDeps = {
  db: Db;
  env: Env;
  tenant: TenantContext;
  actor: AuthUser;
  requestId: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const INVITATION_TTL_MS = 7 * DAY_MS;
// Cuota de ADR-010: 20 invitaciones por día (UTC) por organización.
const INVITATIONS_PER_DAY = 20;

/** `pedro@example.com` → `p***@example.com`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return `${email.slice(0, Math.min(1, at))}***${email.slice(at)}`;
}

function invalidBranches(message: string) {
  return new AppError("VALIDATION_FAILED", message, { branchIds: [message] });
}

/** Todas las sucursales deben ser de la organización; si no, se responde como dato inválido. */
async function assertOrgBranches(deps: OrgDeps, branchIds: string[]) {
  const found = await findOrgBranchIds(deps.db, deps.tenant.orgId, branchIds);
  if (found.length !== branchIds.length) {
    throw invalidBranches("Alguna sucursal no existe. Actualiza la página y elige de nuevo.");
  }
}

function page<T extends { id: string }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
}

// Miembros ----------------------------------------------------------------------------------

type MemberRow = NonNullable<Awaited<ReturnType<typeof findActiveMember>>>;

function toMemberDto(row: MemberRow, viewer: TenantContext): MemberDto {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    // `staff` ve a su equipo, pero no los correos completos.
    email: viewer.role === "staff" ? maskEmail(row.email) : row.email,
    role: row.role,
    branchIds: JSON.parse(row.branchIds) as string[],
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listMembers(deps: OrgDeps, query: CursorQuery): Promise<MemberListDto> {
  const rows = await listActiveMembers(deps.db, deps.tenant, query);
  const { items, nextCursor } = page(rows, query.limit);
  return { items: items.map((row) => toMemberDto(row, deps.tenant)), nextCursor };
}

async function loadMemberAuthView(deps: OrgDeps, memberId: string) {
  const target = await findMemberAuthView(deps.db, deps.tenant, memberId);
  if (!target) throw new AppError("NOT_FOUND");
  return target;
}

/**
 * Cambia rol y/o sucursales (ADR-007). Política primero, luego la combinación final:
 * `staff` necesita al menos una sucursal y los demás roles no llevan sucursales.
 */
export async function updateMember(
  deps: OrgDeps,
  memberId: string,
  input: UpdateMemberInput,
): Promise<MemberDto> {
  const target = await loadMemberAuthView(deps, memberId);
  assertAllowed(canManageMember(deps.tenant, target, { action: "update", role: input.role }));
  const newRole: MemberRole = input.role ?? target.role;
  if (newRole !== "staff" && input.branchIds) throw invalidBranches(BRANCHES_ONLY_FOR_STAFF);
  if (newRole === "staff" && target.role !== "staff" && !input.branchIds) {
    throw invalidBranches(STAFF_BRANCHES_REQUIRED);
  }
  if (input.branchIds) await assertOrgBranches(deps, input.branchIds);
  // Al dejar de ser `staff`, sus sucursales asignadas se borran.
  const branchIds =
    input.branchIds ?? (target.role === "staff" && newRole !== "staff" ? [] : undefined);
  const guardLastOwner = target.role === "owner" && newRole !== "owner";
  const applied = await updateMemberRow(deps.db, deps.tenant, memberId, {
    role: input.role,
    branchIds,
    guardLastOwner,
  });
  if (!applied) {
    if (guardLastOwner) throw new AppError("BUSINESS_RULE", LAST_OWNER_MESSAGE);
    throw new AppError("NOT_FOUND");
  }
  log.info("member.updated", { requestId: deps.requestId, orgId: deps.tenant.orgId });
  const row = await findActiveMember(deps.db, deps.tenant, memberId);
  if (!row) throw new AppError("NOT_FOUND");
  return toMemberDto(row, deps.tenant);
}

/** Quita a un miembro (`status = 'removed'`) y sus sucursales. Nunca al último `owner`. */
export async function removeMember(deps: OrgDeps, memberId: string): Promise<void> {
  const target = await loadMemberAuthView(deps, memberId);
  assertAllowed(canManageMember(deps.tenant, target, { action: "remove" }));
  const guardLastOwner = target.role === "owner";
  if (!(await removeMemberRow(deps.db, deps.tenant, memberId, guardLastOwner))) {
    if (guardLastOwner) throw new AppError("BUSINESS_RULE", LAST_OWNER_MESSAGE);
    throw new AppError("NOT_FOUND");
  }
  log.info("member.removed", { requestId: deps.requestId, orgId: deps.tenant.orgId });
}

// Invitaciones (privadas) -------------------------------------------------------------------

type InvitationRow = Awaited<ReturnType<typeof listPendingInvitations>>[number];

function toInvitationDto(row: InvitationRow, now: Date): InvitationDto {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    branchIds: row.branchIds,
    expired: row.expiresAt <= now,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Texto para el asunto del correo: `DisplayName` de `contracts` no admite vacío ni > 120. */
function displayName(value: string, fallback: string) {
  const clean = value
    .replace(/\p{Cc}/gu, " ")
    .trim()
    .slice(0, 120);
  return clean || fallback;
}

/**
 * Invita por correo (ADR-007, ADR-008, ADR-010). Si ya había una invitación pendiente para ese
 * correo, se revoca en el mismo batch: invitar de nuevo funciona como reenvío. El correo se
 * encola; nunca se envía en línea. El token solo viaja en el correo; en la base va su hash.
 */
export async function createInvitation(
  deps: OrgDeps,
  input: CreateInvitationInput,
): Promise<InvitationDto> {
  assertAllowed(canInviteMember(deps.tenant, input.role));
  const email = await assertDeliverableEmail(
    { db: deps.db, requestId: deps.requestId },
    input.email,
  );
  const branchIds = input.role === "staff" ? (input.branchIds ?? []) : [];
  if (branchIds.length > 0) await assertOrgBranches(deps, branchIds);
  if (await isActiveMemberEmail(deps.db, deps.tenant, email)) {
    throw new AppError("CONFLICT", "Esta persona ya es miembro de la organización.");
  }
  // Antes de la cuota: una invitación que no se puede enviar no gasta el cupo del día.
  await assertWithinLimit(deps, "members");
  const quota = await hit(deps.db, `invitations:${deps.tenant.orgId}`, DAY_MS, INVITATIONS_PER_DAY);
  if (!quota.allowed) {
    log.warn("invitation.quota_exceeded", { requestId: deps.requestId, orgId: deps.tenant.orgId });
    throw new AppError(
      "RATE_LIMITED",
      "Ya enviaste 20 invitaciones hoy. Inténtalo de nuevo mañana.",
      undefined,
      quota.retryAfterMs / 1000,
    );
  }
  const organization = await findOrganization(deps.db, deps.tenant);
  if (!organization) throw new AppError("NOT_FOUND");
  const token = newPublicToken();
  const now = new Date();
  const invitation = {
    id: newId(),
    email,
    role: input.role,
    branchIds,
    tokenHash: await hashToken(token),
    expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    createdAt: now,
  };
  await insertInvitation(deps.db, deps.tenant, invitation);
  await enqueue(deps.env, {
    type: "email.send",
    id: newId(),
    to: email,
    template: "invitation",
    data: {
      url: invitationLink(deps.env, token),
      organizationName: displayName(organization.name, "tu equipo"),
      inviterName: displayName(deps.actor.name, "Alguien de tu equipo"),
    },
  });
  log.info("invitation.created", { requestId: deps.requestId, orgId: deps.tenant.orgId });
  return toInvitationDto(invitation, now);
}

export async function listInvitations(
  deps: OrgDeps,
  query: CursorQuery,
): Promise<InvitationListDto> {
  const rows = await listPendingInvitations(deps.db, deps.tenant, query);
  const { items, nextCursor } = page(rows, query.limit);
  const now = new Date();
  return { items: items.map((row) => toInvitationDto(row, now)), nextCursor };
}

/** Revoca una invitación pendiente. `admin` solo revoca invitaciones de `staff`. */
export async function revokeInvitation(deps: OrgDeps, invitationId: string): Promise<void> {
  const invitation = await findPendingInvitation(deps.db, deps.tenant, invitationId);
  if (!invitation) throw new AppError("NOT_FOUND");
  assertAllowed(canInviteMember(deps.tenant, invitation.role));
  if (!(await revokeInvitationRow(deps.db, deps.tenant, invitationId, new Date()))) {
    throw new AppError("NOT_FOUND");
  }
  log.info("invitation.revoked", { requestId: deps.requestId, orgId: deps.tenant.orgId });
}

// Invitaciones (públicas) -------------------------------------------------------------------

const INVITATION_GONE = "Esta invitación ya no es válida. Pide una nueva a quien te invitó.";

type TokenInvitation = NonNullable<Awaited<ReturnType<typeof findInvitationByTokenHash>>>;

async function findByToken(db: Db, token: string) {
  return findInvitationByTokenHash(db, await hashToken(token));
}

/** Error para una invitación que ya no se puede canjear; `undefined` si sigue vigente. */
function unusableReason(invitation: TokenInvitation | undefined, now: Date) {
  if (!invitation) return new AppError("NOT_FOUND", INVITATION_GONE);
  if (invitation.acceptedAt) return new AppError("CONFLICT", "Esta invitación ya se usó.");
  if (invitation.revokedAt) {
    return new AppError(
      "BUSINESS_RULE",
      "Esta invitación se canceló. Pide una nueva a quien te invitó.",
    );
  }
  if (invitation.expiresAt <= now) {
    return new AppError(
      "BUSINESS_RULE",
      "Esta invitación venció. Pide una nueva a quien te invitó.",
    );
  }
  return undefined;
}

/**
 * Vista previa para quien abre el enlace. Inexistente, aceptada o revocada → `NOT_FOUND`;
 * vencida → `expired: true` para que WEB lo explique.
 */
export async function previewInvitation(db: Db, token: string): Promise<InvitationPreviewDto> {
  const invitation = await findByToken(db, token);
  if (!invitation || invitation.acceptedAt || invitation.revokedAt) {
    throw new AppError("NOT_FOUND", INVITATION_GONE);
  }
  return {
    orgName: invitation.orgName,
    role: invitation.role,
    emailMasked: maskEmail(invitation.email),
    expired: invitation.expiresAt <= new Date(),
    accountExists: await accountExists(db, invitation.email),
  };
}

export type AcceptDeps = {
  db: Db;
  env: Env;
  requestId: string;
  clientIp: string | undefined;
  user: AuthUser | null;
  headers: Headers;
};

/** Cuenta que acepta: la de la sesión (mismo correo) o una nueva sin sesión ni cuenta previa. */
async function resolveAcceptingUser(
  deps: AcceptDeps,
  invitation: TokenInvitation,
  input: AcceptInvitationInput,
) {
  if (deps.user) {
    if (normalizeEmail(deps.user.email) !== invitation.email) {
      throw new AppError("CONFLICT", "Esta invitación es para otro correo.");
    }
    return { userId: deps.user.id, setCookies: [] };
  }
  if (await accountExists(deps.db, invitation.email)) {
    throw new AppError("AUTH_REQUIRED", ACCOUNT_EXISTS_MESSAGE);
  }
  if (!input?.name || !input.password) {
    throw new AppError("VALIDATION_FAILED", "Escribe tu nombre y una contraseña para tu cuenta.", {
      ...(!input?.name && { name: ["Escribe tu nombre."] }),
      ...(!input?.password && { password: ["Escribe una contraseña de 10 a 128 caracteres."] }),
    });
  }
  return createInvitedUser(deps, deps.headers, {
    email: invitation.email,
    name: input.name,
    password: input.password,
  });
}

/**
 * Canjea una invitación (T13). Sin sesión exige Turnstile. Respeta el límite de miembros del
 * plan (T14) antes de crear la cuenta y, de nuevo, dentro del batch. Marca el token usado, crea o reactiva
 * la membresía, asigna sucursales y marca el correo verificado (el enlace lo probó) en un solo
 * `db.batch`. La cuenta nueva la crea Better Auth antes del batch: si el batch falla, el token
 * sigue sin usar y la persona puede entrar con su cuenta y aceptar de nuevo.
 */
export async function acceptInvitation(
  deps: AcceptDeps,
  token: string,
  input: AcceptInvitationInput,
): Promise<AcceptInvitationDto & { setCookies: string[] }> {
  if (!deps.user) {
    await verifyTurnstile(deps.env, deps.headers.get(TURNSTILE_HEADER), deps.clientIp);
  }
  const invitation = await findByToken(deps.db, token);
  const unusable = unusableReason(invitation, new Date());
  if (unusable || !invitation) throw unusable ?? new AppError("NOT_FOUND", INVITATION_GONE);
  // Antes de crear la cuenta: si el equipo ya no tiene lugar, no se crea una cuenta huérfana.
  await assertMemberSlotForInvitation(deps.db, invitation.orgId, deps.requestId);

  const { userId, setCookies } = await resolveAcceptingUser(deps, invitation, input);
  const membership = await findMembershipOfUser(deps.db, invitation.orgId, userId);
  if (membership?.status === "active") {
    throw new AppError("CONFLICT", "Ya eres miembro de esta organización.");
  }
  // Una sucursal pudo dejar de existir desde que se invitó; se asignan las que siguen.
  const branchIds =
    invitation.role === "staff"
      ? await findOrgBranchIds(deps.db, invitation.orgId, invitation.branchIds)
      : [];
  const claim = {
    invitationId: invitation.id,
    orgId: invitation.orgId,
    userId,
    role: invitation.role,
    branchIds,
    memberId: membership?.id ?? newId(),
    reactivate: membership !== undefined,
    now: new Date(),
  };
  const [claimed] = await deps.db.batch([
    ...claimInvitationStatements(deps.db, claim, memberSlotCondition(deps.db, claim.orgId)),
    emailVerifiedStatement(deps.db, userId, invitationClaimed(deps.db, claim)),
  ]);
  if (claimed.meta.changes === 0) {
    // Otra petición la canjeó, la revocó o venció, o el equipo se llenó, entre la lectura y
    // el batch.
    const current = await findInvitationByTokenHash(deps.db, await hashToken(token));
    const reason = unusableReason(current, claim.now);
    if (reason) throw reason;
    await assertMemberSlotForInvitation(deps.db, claim.orgId, deps.requestId);
    throw new AppError("CONFLICT", "Esta invitación ya se usó.");
  }
  log.info("invitation.accepted", { requestId: deps.requestId, orgId: invitation.orgId });
  return { orgId: invitation.orgId, setCookies };
}
