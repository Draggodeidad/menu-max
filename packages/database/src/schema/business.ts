import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { id, organizationId, timestamps, version } from "./columns";
import { organizations } from "./tenancy";

// Negocio (ADR-006, ADR-016). Las columnas de operación de `branches` llegan en T15; las zonas de
// entrega (`delivery_zones`) esperan a ADR-018.

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

/**
 * Sucursal: la ubicación que publica un menú y recibe pedidos. Las reglas entre columnas (al
 * menos una modalidad, mesas si atiende en mesa) las valida el servicio, no un `CHECK`.
 */
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
    /** Teléfono público de contacto en E.164. */
    contactPhone: text("contact_phone"),
    modeTable: integer("mode_table", { mode: "boolean" }).notNull().default(false),
    modePickup: integer("mode_pickup", { mode: "boolean" }).notNull().default(true),
    modeDelivery: integer("mode_delivery", { mode: "boolean" }).notNull().default(false),
    tableCount: integer("table_count").notNull().default(0),
    /** Tope del total de un pedido en centavos; `null` = sin tope. */
    maxOrderTotalCents: integer("max_order_total_cents"),
    /** Número E.164 que recibe los avisos de pedidos por WhatsApp. */
    alertWhatsapp: text("alert_whatsapp"),
    /** Cuándo quien capturó `alert_whatsapp` confirmó que el número acepta avisos. */
    alertOptInAt: integer("alert_opt_in_at", { mode: "timestamp_ms" }),
    nextOrderNumber: integer("next_order_number").notNull().default(1),
    version: version(),
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

/**
 * Rangos de atención por día en la hora local de la sucursal (`branches.timezone`). Puede haber
 * varios por día; un rango que cruza medianoche se guarda como dos (`… → 24:00` y `00:00 → …`).
 * La semana completa se reemplaza en un solo `db.batch`.
 */
export const businessHours = sqliteTable(
  "business_hours",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id, {
      onDelete: "restrict",
    }),
    branchId: text("branch_id").notNull(),
    /** 0 = domingo … 6 = sábado. */
    weekday: integer("weekday").notNull(),
    /** `HH:MM`, de `00:00` a `23:59`. */
    opensAt: text("opens_at").notNull(),
    /** `HH:MM`, de `00:01` a `24:00`; siempre mayor que `opens_at`. */
    closesAt: text("closes_at").notNull(),
  },
  (table) => [
    index("business_hours_org_branch_idx").on(table.organizationId, table.branchId),
    foreignKey({
      name: "business_hours_branch_fk",
      columns: [table.organizationId, table.branchId],
      foreignColumns: [branches.organizationId, branches.id],
    }).onDelete("restrict"),
    check("business_hours_weekday_check", sql`${table.weekday} between 0 and 6`),
    check("business_hours_range_check", sql`${table.opensAt} < ${table.closesAt}`),
  ],
);
