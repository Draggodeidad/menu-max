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

// Miembros e invitaciones (T13, ADR-007).

export const MemberParams = z.strictObject({ memberId: z.uuidv7() });
export const InvitationParams = z.strictObject({ invitationId: z.uuidv7() });
/** Token público de invitación: 32 bytes en base64url (ADR-013). */
export const InvitationTokenParams = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

/** Paginación por cursor: `cursor` es el `nextCursor` de la página anterior. */
export const CursorQuery = z.strictObject({
  cursor: z.uuidv7().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type CursorQuery = z.infer<typeof CursorQuery>;

const BranchIds = z
  .array(z.uuidv7())
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, { message: "Hay sucursales repetidas." });

export const STAFF_BRANCHES_REQUIRED = "Asigna al menos una sucursal al personal.";
export const BRANCHES_ONLY_FOR_STAFF =
  "Solo el personal tiene sucursales asignadas; dueños y administradores operan todas.";

/** `staff` necesita al menos una sucursal; `owner` y `admin` no llevan `branchIds`. */
export const CreateInvitationInput = z
  .strictObject({
    email: z.email().max(254),
    role: MemberRole,
    branchIds: BranchIds.optional(),
  })
  .superRefine((input, ctx) => {
    if (input.role === "staff" && !input.branchIds) {
      ctx.addIssue({ code: "custom", path: ["branchIds"], message: STAFF_BRANCHES_REQUIRED });
    }
    if (input.role !== "staff" && input.branchIds) {
      ctx.addIssue({ code: "custom", path: ["branchIds"], message: BRANCHES_ONLY_FOR_STAFF });
    }
  });
export type CreateInvitationInput = z.infer<typeof CreateInvitationInput>;

/** Cambia el rol, las sucursales o ambos. La combinación final la valida el servicio. */
export const UpdateMemberInput = z
  .strictObject({ role: MemberRole.optional(), branchIds: BranchIds.optional() })
  .refine((input) => input.role !== undefined || input.branchIds !== undefined, {
    message: "Indica el rol o las sucursales que quieres cambiar.",
  });
export type UpdateMemberInput = z.infer<typeof UpdateMemberInput>;

/** Sin sesión y sin cuenta: nombre y contraseña de la cuenta nueva. Con sesión: cuerpo vacío. */
export const AcceptInvitationInput = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[^\p{Cc}]+$/u)
      .optional(),
    password: z.string().min(10).max(128).optional(),
  })
  .optional();
export type AcceptInvitationInput = z.infer<typeof AcceptInvitationInput>;

/** `email` va enmascarado (`p***@dominio.com`) cuando quien consulta es `staff`. */
export const MemberDto = z
  .strictObject({
    id: z.uuidv7(),
    userId: z.uuidv7(),
    name: z.string(),
    email: z.string(),
    role: MemberRole,
    branchIds: z.array(z.uuidv7()),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "MemberDto" });
export type MemberDto = z.infer<typeof MemberDto>;

export const MemberListDto = z
  .strictObject({ items: z.array(MemberDto), nextCursor: z.uuidv7().nullable() })
  .meta({ id: "MemberListDto" });
export type MemberListDto = z.infer<typeof MemberListDto>;

/** Invitación pendiente; `expired` indica que ya venció sin aceptarse. */
export const InvitationDto = z
  .strictObject({
    id: z.uuidv7(),
    email: z.email(),
    role: MemberRole,
    branchIds: z.array(z.uuidv7()),
    expired: z.boolean(),
    expiresAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "InvitationDto" });
export type InvitationDto = z.infer<typeof InvitationDto>;

export const InvitationListDto = z
  .strictObject({ items: z.array(InvitationDto), nextCursor: z.uuidv7().nullable() })
  .meta({ id: "InvitationListDto" });
export type InvitationListDto = z.infer<typeof InvitationListDto>;

/**
 * Vista previa pública para quien tiene el enlace. `accountExists` le dice a WEB si pide entrar
 * con la cuenta o crear una con nombre y contraseña.
 */
export const InvitationPreviewDto = z
  .strictObject({
    orgName: z.string(),
    role: MemberRole,
    emailMasked: z.string(),
    expired: z.boolean(),
    accountExists: z.boolean(),
  })
  .meta({ id: "InvitationPreviewDto" });
export type InvitationPreviewDto = z.infer<typeof InvitationPreviewDto>;

export const AcceptInvitationDto = z
  .strictObject({ orgId: z.uuidv7() })
  .meta({ id: "AcceptInvitationDto" });
export type AcceptInvitationDto = z.infer<typeof AcceptInvitationDto>;
