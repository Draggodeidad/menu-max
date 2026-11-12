import { integer, text } from "drizzle-orm/sqlite-core";

// Columnas comunes de todas las tablas (ADR-003, ADR-013). Cada helper devuelve
// constructores nuevos: no compartas una misma instancia entre tablas.

/** Llave primaria UUIDv7 en `text`. El valor lo genera el servicio con `newId()`. */
export const id = () => text("id").primaryKey();

/** Tenant dueño de la fila. Todo repositorio de tenant filtra por esta columna. */
export const organizationId = () => text("organization_id").notNull();

/** `created_at` y `updated_at` en milisegundos desde epoch. */
export const timestamps = () => ({
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
});

/** Concurrencia optimista: el servicio compara y aumenta `version` en cada escritura. */
export const version = () => integer("version").notNull().default(1);

/** Borrado lógico; `null` mientras la fila esté activa. */
export const deletedAt = () => integer("deleted_at", { mode: "timestamp_ms" });
