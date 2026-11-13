import { branches, memberBranches, organizationMembers, organizations } from "@menu-max/database";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../../infrastructure/db";
import type { TenantContext } from "../../types";

/**
 * Membresía activa de `(orgId, userId)` y sus sucursales asignadas, en un solo viaje a D1.
 * Todavía no hay `tenant`: filtra por el `orgId` de la ruta, que es lo que se está verificando.
 */
export async function findActiveMembership(db: Db, orgId: string, userId: string) {
  const activeMember = and(
    eq(organizationMembers.organizationId, orgId),
    eq(organizationMembers.userId, userId),
    eq(organizationMembers.status, "active"),
  );
  const [members, assigned] = await db.batch([
    db
      .select({ id: organizationMembers.id, role: organizationMembers.role })
      .from(organizationMembers)
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
