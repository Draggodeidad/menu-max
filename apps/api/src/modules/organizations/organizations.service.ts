import type { MembershipDto, OrganizationDto } from "@menu-max/contracts";
import type { Db } from "../../infrastructure/db";
import { AppError } from "../../shared/errors";
import type { TenantContext } from "../../types";
import {
  findActiveMembership,
  findBranch,
  findOrganization,
  listActiveMemberships,
} from "./organizations.repository";

/** Contexto del tenant o `null` si el usuario no tiene membresía activa en la organización. */
export async function loadTenant(
  db: Db,
  orgId: string,
  userId: string,
): Promise<TenantContext | null> {
  const member = await findActiveMembership(db, orgId, userId);
  if (!member) return null;
  return { orgId, memberId: member.id, role: member.role, branchIds: member.branchIds };
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
