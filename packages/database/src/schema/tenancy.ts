import { MEMBER_ROLES, MEMBER_STATUSES } from "@menu-max/contracts";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { branches } from "./business";
import { id, organizationId, timestamps } from "./columns";

// Tenancy (ADR-006, ADR-016). `invitations` llega en T13.

function inList(column: unknown, values: readonly string[]) {
  return sql`${column} in (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`.inlineParams();
}

/** El tenant. Su `id` es el `organization_id` de todas las tablas de negocio. */
export const organizations = sqliteTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  ...timestamps(),
});

/** Membresía de un usuario en una organización. Se remueve con `status`, nunca se borra. */
export const organizationMembers = sqliteTable(
  "organization_members",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id, {
      onDelete: "restrict",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: text("role", { enum: MEMBER_ROLES }).notNull(),
    status: text("status", { enum: MEMBER_STATUSES }).notNull().default("active"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("organization_members_org_user_unique").on(table.organizationId, table.userId),
    // Destino de las FKs compuestas que garantizan que miembro y fila sean del mismo tenant.
    uniqueIndex("organization_members_org_id_unique").on(table.organizationId, table.id),
    // `GET /v1/me`: membresías activas del usuario.
    index("organization_members_user_status_idx").on(table.userId, table.status),
    check("organization_members_role_check", inList(table.role, MEMBER_ROLES)),
    check("organization_members_status_check", inList(table.status, MEMBER_STATUSES)),
  ],
);

/** Sucursales que opera un miembro `staff`. `owner` y `admin` no necesitan filas. */
export const memberBranches = sqliteTable(
  "member_branches",
  {
    organizationId: organizationId().references(() => organizations.id, {
      onDelete: "restrict",
    }),
    memberId: text("member_id").notNull(),
    branchId: text("branch_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.memberId, table.branchId] }),
    index("member_branches_org_member_idx").on(table.organizationId, table.memberId),
    index("member_branches_org_branch_idx").on(table.organizationId, table.branchId),
    foreignKey({
      name: "member_branches_member_fk",
      columns: [table.organizationId, table.memberId],
      foreignColumns: [organizationMembers.organizationId, organizationMembers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "member_branches_branch_fk",
      columns: [table.organizationId, table.branchId],
      foreignColumns: [branches.organizationId, branches.id],
    }).onDelete("restrict"),
  ],
);
