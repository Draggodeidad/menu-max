import { z } from "zod";

// Tenancy (ADR-006). Las constantes generan los CHECK de `packages/database`.
export const MEMBER_ROLES = ["owner", "admin", "staff"] as const;
export const MEMBER_STATUSES = ["active", "removed"] as const;

export const MemberRole = z.enum(MEMBER_ROLES);
export type MemberRole = z.infer<typeof MemberRole>;

/** Parámetros de `/v1/orgs/:orgId`. Un id con otro formato se responde como `NOT_FOUND`. */
export const OrgParams = z.strictObject({ orgId: z.uuidv7() });
export const BranchParams = z.strictObject({ branchId: z.uuidv7() });

export const OrganizationDto = z
  .strictObject({ id: z.uuidv7(), name: z.string(), role: MemberRole })
  .meta({ id: "OrganizationDto" });
export type OrganizationDto = z.infer<typeof OrganizationDto>;

export const MembershipDto = z
  .strictObject({ orgId: z.uuidv7(), orgName: z.string(), role: MemberRole })
  .meta({ id: "MembershipDto" });
export type MembershipDto = z.infer<typeof MembershipDto>;
