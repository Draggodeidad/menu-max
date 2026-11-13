import { foreignKey, index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, organizationId, timestamps } from "./columns";
import { organizations } from "./tenancy";

// Negocio (ADR-006, ADR-016). Las columnas de operación de `branches` llegan en T15.

/** La marca o comercio dentro de la organización. */
export const businesses = sqliteTable(
  "businesses",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    ...timestamps(),
  },
  (table) => [
    // Destino de la FK compuesta de `branches` y lista de negocios del tenant.
    uniqueIndex("businesses_org_id_unique").on(table.organizationId, table.id),
  ],
);

/** Sucursal: la ubicación que publica un menú y recibe pedidos. */
export const branches = sqliteTable(
  "branches",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id, {
      onDelete: "restrict",
    }),
    businessId: text("business_id").notNull(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("America/Mexico_City"),
    ...timestamps(),
  },
  (table) => [
    // `requireBranch` y destino de FKs compuestas (`member_branches`).
    uniqueIndex("branches_org_id_unique").on(table.organizationId, table.id),
    index("branches_org_business_idx").on(table.organizationId, table.businessId),
    // El negocio debe ser del mismo tenant que la sucursal.
    foreignKey({
      name: "branches_business_fk",
      columns: [table.organizationId, table.businessId],
      foreignColumns: [businesses.organizationId, businesses.id],
    }).onDelete("restrict"),
  ],
);
