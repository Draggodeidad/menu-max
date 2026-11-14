import type { CursorQuery, MemberRole } from "@menu-max/contracts";
import {
  branches,
  invitations,
  memberBranches,
  organizationMembers,
  organizations,
  plans,
  subscriptions,
  users,
} from "@menu-max/database";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lt,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "../../infrastructure/db";
import type { TenantContext } from "../../types";

/**
 * Membresía activa de `(orgId, userId)`, el plan de la organización (T14) y las sucursales
 * asignadas, en un solo viaje a D1. Todavía no hay `tenant`: filtra por el `orgId` de la ruta,
 * que es lo que se está verificando. Sin suscripción, los campos del plan llegan en `null`.
 */
export async function findActiveMembership(db: Db, orgId: string, userId: string) {
  const activeMember = and(
    eq(organizationMembers.organizationId, orgId),
    eq(organizationMembers.userId, userId),
    eq(organizationMembers.status, "active"),
  );
  const [members, assigned] = await db.batch([
    db
      .select({
        id: organizationMembers.id,
        role: organizationMembers.role,
        // `subscriptions.plan_id` y no `plans.id`: D1 arma las filas de `batch` por nombre de
        // columna y dos `id` se pisarían.
        planId: subscriptions.planId,
        status: subscriptions.status,
        maxBranches: plans.maxBranches,
        maxProducts: plans.maxProducts,
        maxMembers: plans.maxMembers,
      })
      .from(organizationMembers)
      .leftJoin(subscriptions, eq(subscriptions.organizationId, organizationMembers.organizationId))
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .where(activeMember)
      .limit(1),
    db
      .select({ branchId: memberBranches.branchId })
      .from(memberBranches)
      .innerJoin(
        organizationMembers,
        and(
          eq(organizationMembers.organizationId, memberBranches.organizationId),
          eq(organizationMembers.id, memberBranches.memberId),
        ),
      )
      .where(and(eq(memberBranches.organizationId, orgId), activeMember)),
  ]);
  const member = members[0];
  return member ? { ...member, branchIds: assigned.map((row) => row.branchId) } : undefined;
}

export function findOrganization(db: Db, tenant: TenantContext) {
  return db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, tenant.orgId))
    .get();
}

/** Membresías activas de un usuario. No es de un tenant: filtra por el usuario de la sesión. */
export function listActiveMemberships(db: Db, userId: string) {
  return db
    .select({
      orgId: organizations.id,
      orgName: organizations.name,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.status, "active")))
    .orderBy(asc(organizationMembers.createdAt), asc(organizationMembers.id));
}

export function findBranch(db: Db, tenant: TenantContext, branchId: string) {
  return db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.organizationId, tenant.orgId), eq(branches.id, branchId)))
    .get();
}

// Miembros (T13) ----------------------------------------------------------------------------

/** Sucursales asignadas del miembro de la fila, como arreglo JSON (`[]` si no tiene). */
const assignedBranchIds = sql<string>`(
  select json_group_array(${memberBranches.branchId}) from ${memberBranches}
  where ${memberBranches.organizationId} = ${organizationMembers.organizationId}
    and ${memberBranches.memberId} = ${organizationMembers.id}
)`;

const memberFields = {
  id: organizationMembers.id,
  userId: organizationMembers.userId,
  name: users.name,
  email: users.email,
  role: organizationMembers.role,
  branchIds: assignedBranchIds,
  createdAt: organizationMembers.createdAt,
};

/** Página de miembros activos ordenada por id; trae `limit + 1` para saber si hay otra. */
export function listActiveMembers(db: Db, tenant: TenantContext, page: CursorQuery) {
  return db
    .select(memberFields)
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, tenant.orgId),
        eq(organizationMembers.status, "active"),
        page.cursor ? gt(organizationMembers.id, page.cursor) : undefined,
      ),
    )
    .orderBy(asc(organizationMembers.id))
    .limit(page.limit + 1);
}

export function findActiveMember(db: Db, tenant: TenantContext, memberId: string) {
  return db
    .select(memberFields)
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, tenant.orgId),
        eq(organizationMembers.id, memberId),
        eq(organizationMembers.status, "active"),
      ),
    )
    .get();
}

/** Miembro activo sobre el que se actúa y cuántos `owner` activos tiene la organización. */
export async function findMemberAuthView(db: Db, tenant: TenantContext, memberId: string) {
  const [members, owners] = await db.batch([
    db
      .select({ id: organizationMembers.id, role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, tenant.orgId),
          eq(organizationMembers.id, memberId),
          eq(organizationMembers.status, "active"),
        ),
      )
      .limit(1),
    db
      .select({ count: count() })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, tenant.orgId),
          eq(organizationMembers.role, "owner"),
          eq(organizationMembers.status, "active"),
        ),
      ),
  ]);
  const member = members[0];
  return member ? { ...member, activeOwnerCount: owners[0]?.count ?? 0 } : undefined;
}

/**
 * Ids de `branchIds` que sí son sucursales de la organización. Recibe `orgId` y no `tenant`
 * porque también lo usa la aceptación pública, donde la organización sale de la invitación.
 */
export async function findOrgBranchIds(db: Db, orgId: string, branchIds: string[]) {
  if (branchIds.length === 0) return [];
  const rows = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.organizationId, orgId), inArray(branches.id, branchIds)));
  return rows.map((row) => row.id);
}

/**
 * Condición SQL: la organización conserva otro `owner` activo además del miembro. Cierra la
 * carrera de dos dueños que se quitan el rol al mismo tiempo (la política ya lo revisó antes).
 */
function keepsAnotherOwner(db: Db, tenant: TenantContext, memberId: string) {
  const owners = alias(organizationMembers, "owners");
  return exists(
    db
      .select({ one: sql`1` })
      .from(owners)
      .where(
        and(
          eq(owners.organizationId, tenant.orgId),
          eq(owners.role, "owner"),
          eq(owners.status, "active"),
          sql`${owners.id} <> ${memberId}`,
        ),
      ),
  );
}

function activeMemberWhere(tenant: TenantContext, memberId: string) {
  return and(
    eq(organizationMembers.organizationId, tenant.orgId),
    eq(organizationMembers.id, memberId),
    eq(organizationMembers.status, "active"),
  );
}

/**
 * Asigna sucursales solo si el miembro sigue activo como `staff` cuando corre la sentencia (en
 * el mismo batch, después del cambio de rol). Si el cambio no se aplicó, no inserta nada.
 */
function assignBranches(db: Db, tenant: TenantContext, memberId: string, branchIds: string[]) {
  return branchIds.map((branchId) =>
    db.insert(memberBranches).select(
      db
        .select({
          organizationId: organizationMembers.organizationId,
          memberId: organizationMembers.id,
          branchId: sql<string>`${branchId}`.as("branch_id"),
        })
        .from(organizationMembers)
        .where(and(activeMemberWhere(tenant, memberId), eq(organizationMembers.role, "staff"))),
    ),
  );
}

function clearBranches(db: Db, tenant: TenantContext, memberId: string) {
  return db
    .delete(memberBranches)
    .where(
      and(eq(memberBranches.organizationId, tenant.orgId), eq(memberBranches.memberId, memberId)),
    );
}

/**
 * Cambia rol y/o sucursales en un solo batch. `branchIds` reemplaza las asignadas; `undefined`
 * las deja igual. Con `guardLastOwner`, el cambio solo se aplica si queda otro `owner` activo.
 * La primera sentencia es la que decide: `meta.changes === 0` → no se aplicó nada.
 */
export async function updateMember(
  db: Db,
  tenant: TenantContext,
  memberId: string,
  change: { role?: MemberRole; branchIds?: string[]; guardLastOwner: boolean },
) {
  const [updated] = await db.batch([
    db
      .update(organizationMembers)
      .set({ ...(change.role && { role: change.role }), updatedAt: new Date() })
      .where(
        and(
          activeMemberWhere(tenant, memberId),
          change.guardLastOwner ? keepsAnotherOwner(db, tenant, memberId) : undefined,
        ),
      ),
    ...(change.branchIds
      ? [
          clearBranches(db, tenant, memberId),
          ...assignBranches(db, tenant, memberId, change.branchIds),
        ]
      : []),
  ]);
  return updated.meta.changes > 0;
}

/** `status = 'removed'` y borra sus sucursales. Mismo `guardLastOwner` que `updateMember`. */
export async function removeMember(
  db: Db,
  tenant: TenantContext,
  memberId: string,
  guardLastOwner: boolean,
) {
  const [updated] = await db.batch([
    db
      .update(organizationMembers)
      .set({ status: "removed", updatedAt: new Date() })
      .where(
        and(
          activeMemberWhere(tenant, memberId),
          guardLastOwner ? keepsAnotherOwner(db, tenant, memberId) : undefined,
        ),
      ),
    clearBranches(db, tenant, memberId),
  ]);
  return updated.meta.changes > 0;
}

// Invitaciones (T13) ------------------------------------------------------------------------

const invitationFields = {
  id: invitations.id,
  email: invitations.email,
  role: invitations.role,
  branchIds: invitations.branchIds,
  expiresAt: invitations.expiresAt,
  createdAt: invitations.createdAt,
};

function pendingInvitationWhere(tenant: TenantContext) {
  return and(
    eq(invitations.organizationId, tenant.orgId),
    isNull(invitations.acceptedAt),
    isNull(invitations.revokedAt),
  );
}

/** `true` si el correo ya pertenece a un miembro activo de la organización. */
export async function isActiveMemberEmail(db: Db, tenant: TenantContext, email: string) {
  const row = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, tenant.orgId),
        eq(organizationMembers.status, "active"),
        eq(users.email, email),
      ),
    )
    .get();
  return row !== undefined;
}

export type NewInvitation = {
  id: string;
  email: string;
  role: MemberRole;
  branchIds: string[];
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
};

/** Revoca la invitación pendiente del mismo correo (si hay) y crea la nueva, en un batch. */
export async function insertInvitation(db: Db, tenant: TenantContext, invitation: NewInvitation) {
  await db.batch([
    db
      .update(invitations)
      .set({ revokedAt: invitation.createdAt })
      .where(and(pendingInvitationWhere(tenant), eq(invitations.email, invitation.email))),
    db.insert(invitations).values({
      ...invitation,
      organizationId: tenant.orgId,
      invitedByMemberId: tenant.memberId,
    }),
  ]);
}

/** Pendientes (sin aceptar ni revocar, vencidas incluidas), de la más nueva a la más vieja. */
export function listPendingInvitations(db: Db, tenant: TenantContext, page: CursorQuery) {
  return db
    .select(invitationFields)
    .from(invitations)
    .where(
      and(
        pendingInvitationWhere(tenant),
        page.cursor ? lt(invitations.id, page.cursor) : undefined,
      ),
    )
    .orderBy(desc(invitations.id))
    .limit(page.limit + 1);
}

export function findPendingInvitation(db: Db, tenant: TenantContext, invitationId: string) {
  return db
    .select({ id: invitations.id, role: invitations.role })
    .from(invitations)
    .where(and(pendingInvitationWhere(tenant), eq(invitations.id, invitationId)))
    .get();
}

export async function revokeInvitation(
  db: Db,
  tenant: TenantContext,
  invitationId: string,
  now: Date,
) {
  const { meta } = await db
    .update(invitations)
    .set({ revokedAt: now })
    .where(and(pendingInvitationWhere(tenant), eq(invitations.id, invitationId)));
  return meta.changes > 0;
}

/**
 * Invitación por el hash de su token (ruta pública, sin tenant): el token es la credencial y la
 * organización sale de la fila, no del cliente.
 */
export function findInvitationByTokenHash(db: Db, tokenHash: string) {
  return db
    .select({
      id: invitations.id,
      orgId: invitations.organizationId,
      orgName: organizations.name,
      email: invitations.email,
      role: invitations.role,
      branchIds: invitations.branchIds,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      revokedAt: invitations.revokedAt,
    })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
    .where(eq(invitations.tokenHash, tokenHash))
    .get();
}

/** Membresía de `userId` en la organización de la invitación, activa o removida. */
export function findMembershipOfUser(db: Db, orgId: string, userId: string) {
  return db
    .select({ id: organizationMembers.id, status: organizationMembers.status })
    .from(organizationMembers)
    .where(
      and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId)),
    )
    .get();
}

export type InvitationClaim = {
  invitationId: string;
  orgId: string;
  userId: string;
  role: MemberRole;
  branchIds: string[];
  /** Id de la membresía removida a reactivar o de la nueva. */
  memberId: string;
  reactivate: boolean;
  now: Date;
};

/** La invitación quedó canjeada por este batch: `accepted_at` es exactamente `now`. */
export function invitationClaimed(db: Db, claim: InvitationClaim): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(invitations)
      .where(and(eq(invitations.id, claim.invitationId), eq(invitations.acceptedAt, claim.now))),
  );
}

/**
 * Sentencias para canjear una invitación en un solo `db.batch`. La primera marca el token usado
 * solo si sigue pendiente y vigente y se cumple `memberSlot` (lugar en el plan, T14); las demás
 * corren solo si esa lo logró (`invitationClaimed`). El servicio agrega la sentencia de correo
 * verificado del módulo `auth` y revisa la primera.
 */
export function claimInvitationStatements(db: Db, claim: InvitationClaim, memberSlot: SQL) {
  const claimed = invitationClaimed(db, claim);
  const claimedRow = and(
    eq(invitations.id, claim.invitationId),
    eq(invitations.acceptedAt, claim.now),
  );
  const memberWhere = and(
    eq(organizationMembers.organizationId, claim.orgId),
    eq(organizationMembers.id, claim.memberId),
  );
  return [
    db
      .update(invitations)
      .set({ acceptedAt: claim.now })
      .where(
        and(
          eq(invitations.id, claim.invitationId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, claim.now),
          memberSlot,
        ),
      ),
    claim.reactivate
      ? db
          .update(organizationMembers)
          .set({ role: claim.role, status: "active", updatedAt: claim.now })
          .where(and(memberWhere, eq(organizationMembers.status, "removed"), claimed))
      : db.insert(organizationMembers).select(
          db
            .select({
              id: sql<string>`${claim.memberId}`.as("id"),
              organizationId: invitations.organizationId,
              userId: sql<string>`${claim.userId}`.as("user_id"),
              role: invitations.role,
              status: sql<"active">`'active'`.as("status"),
              createdAt: sql<Date>`${claim.now.getTime()}`.as("created_at"),
              updatedAt: sql<Date>`${claim.now.getTime()}`.as("updated_at"),
            })
            .from(invitations)
            .where(claimedRow),
        ),
    ...claim.branchIds.map((branchId) =>
      db.insert(memberBranches).select(
        db
          .select({
            organizationId: invitations.organizationId,
            memberId: sql<string>`${claim.memberId}`.as("member_id"),
            branchId: sql<string>`${branchId}`.as("branch_id"),
          })
          .from(invitations)
          .where(claimedRow),
      ),
    ),
  ] as const;
}
