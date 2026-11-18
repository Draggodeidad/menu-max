import { MEDIA_CONTENT_TYPES } from "@menu-max/contracts";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { deletedAt, id, inList, organizationId } from "./columns";
import { organizationMembers, organizations } from "./tenancy";

// Media (T17, ADR-016). Metadato de cada imagen subida a R2. El objeto es inmutable: una imagen
// nueva es otra fila con otra llave. El borrado es lógico; el objeto lo elimina el Cron de T26.

export const mediaAssets = sqliteTable(
  "media_assets",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id, {
      onDelete: "restrict",
    }),
    /** Llave en R2: `org/{orgId}/media/{id}.{ext}`. Nunca lleva el nombre original. */
    key: text("key").notNull(),
    contentType: text("content_type", { enum: MEDIA_CONTENT_TYPES }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdByMemberId: text("created_by_member_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex("media_assets_key_unique").on(table.key),
    uniqueIndex("media_assets_org_id_unique").on(table.organizationId, table.id),
    foreignKey({
      name: "media_assets_member_fk",
      columns: [table.organizationId, table.createdByMemberId],
      foreignColumns: [organizationMembers.organizationId, organizationMembers.id],
    }).onDelete("restrict"),
    check("media_assets_content_type_check", inList(table.contentType, MEDIA_CONTENT_TYPES)),
    check(
      "media_assets_size_check",
      sql`${table.sizeBytes} > 0 and ${table.width} > 0 and ${table.height} > 0`,
    ),
  ],
);
