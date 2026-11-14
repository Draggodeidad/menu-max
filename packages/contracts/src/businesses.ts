import { z } from "zod";

// Negocio y sucursales (T15, ADR-006, ADR-016). Las zonas de entrega esperan a ADR-018.

const Name = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[^\p{Cc}]+$/u);

/** Teléfono en E.164: `+` y de 8 a 15 dígitos (ej. `+525500000000`). */
export const E164Phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, {
    message: "Escribe el número con lada, por ejemplo +52 55 0000 0000.",
  });

function isTimeZone(value: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone !== "";
  } catch {
    return false;
  }
}

/** Zona horaria IANA (ej. `America/Mexico_City`). */
export const TimeZone = z
  .string()
  .min(1)
  .max(64)
  .refine(isTimeZone, { message: "Elige una zona horaria válida." });

export const MAX_TABLE_COUNT = 200;
export const TableCount = z.int().min(0).max(MAX_TABLE_COUNT);
/** Tope del total de un pedido, en centavos (hasta $1,000,000.00). */
export const MaxOrderTotalCents = z.int().min(1).max(100_000_000);

export const BranchModes = z
  .strictObject({ table: z.boolean(), pickup: z.boolean(), delivery: z.boolean() })
  .meta({ id: "BranchModes" });
export type BranchModes = z.infer<typeof BranchModes>;

export const MODES_REQUIRED =
  "Activa al menos una forma de atender: en mesa, para llevar o a domicilio.";
export const TABLES_REQUIRED = "Indica cuántas mesas tienes para recibir pedidos en mesa.";

// Negocio -----------------------------------------------------------------------------------

export const BusinessDto = z
  .strictObject({ id: z.uuidv7(), name: z.string() })
  .meta({ id: "BusinessDto" });
export type BusinessDto = z.infer<typeof BusinessDto>;

export const UpdateBusinessInput = z.strictObject({ name: Name });
export type UpdateBusinessInput = z.infer<typeof UpdateBusinessInput>;

// Sucursales --------------------------------------------------------------------------------

/** `alertWhatsapp` y `alertOptInAt` son de configuración interna: nunca salen en rutas públicas. */
export const BranchDto = z
  .strictObject({
    id: z.uuidv7(),
    businessId: z.uuidv7(),
    name: z.string(),
    timezone: z.string(),
    contactPhone: z.string().nullable(),
    modes: BranchModes,
    tableCount: TableCount,
    maxOrderTotalCents: z.int().nullable(),
    alertWhatsapp: z.string().nullable(),
    alertOptInAt: z.iso.datetime().nullable(),
    version: z.int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "BranchDto" });
export type BranchDto = z.infer<typeof BranchDto>;

export const BranchListDto = z
  .strictObject({ items: z.array(BranchDto), nextCursor: z.uuidv7().nullable() })
  .meta({ id: "BranchListDto" });
export type BranchListDto = z.infer<typeof BranchListDto>;

/**
 * Sucursal nueva. Las reglas entre campos (al menos una modalidad, mesas si atiende en mesa) las
 * valida el servicio. `alertWhatsapp` implica que quien lo captura confirma que el número acepta
 * avisos.
 */
export const CreateBranchInput = z.strictObject({
  name: Name,
  timezone: TimeZone.optional(),
  contactPhone: E164Phone.nullable().optional(),
  modes: BranchModes,
  tableCount: TableCount.optional(),
  maxOrderTotalCents: MaxOrderTotalCents.nullable().optional(),
  alertWhatsapp: E164Phone.nullable().optional(),
});
export type CreateBranchInput = z.infer<typeof CreateBranchInput>;

/** Cambios parciales con `version` obligatorio (concurrencia optimista). `null` borra el valor. */
export const UpdateBranchInput = z.strictObject({
  version: z.int().positive(),
  name: Name.optional(),
  timezone: TimeZone.optional(),
  contactPhone: E164Phone.nullable().optional(),
  modes: BranchModes.optional(),
  tableCount: TableCount.optional(),
  maxOrderTotalCents: MaxOrderTotalCents.nullable().optional(),
  alertWhatsapp: E164Phone.nullable().optional(),
});
export type UpdateBranchInput = z.infer<typeof UpdateBranchInput>;

// Horarios ----------------------------------------------------------------------------------

/** `HH:MM` de `00:00` a `23:59`. */
export const OpensAt = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  message: "Usa el formato HH:MM, de 00:00 a 23:59.",
});
/** `HH:MM` de `00:00` a `24:00`; `24:00` es el fin del día. */
export const ClosesAt = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, {
  message: "Usa el formato HH:MM, de 00:00 a 24:00.",
});

/** 0 = domingo … 6 = sábado. */
export const Weekday = z.int().min(0).max(6);

export const SAME_OPEN_CLOSE = "La hora de apertura y la de cierre no pueden ser iguales.";

/**
 * Rango de atención en hora local de la sucursal. Si `opensAt` es mayor que `closesAt`, el rango
 * cruza la medianoche y se guarda como dos (`opensAt → 24:00` ese día y `00:00 → closesAt` el
 * siguiente).
 */
export const HoursRangeInput = z
  .strictObject({ weekday: Weekday, opensAt: OpensAt, closesAt: ClosesAt })
  .refine((range) => range.opensAt !== range.closesAt, {
    message: SAME_OPEN_CLOSE,
    path: ["closesAt"],
  });
export type HoursRangeInput = z.infer<typeof HoursRangeInput>;

/** Semana completa; reemplaza la anterior. Lista vacía = sucursal sin horario (siempre cerrada). */
export const ReplaceHoursInput = z.strictObject({ ranges: z.array(HoursRangeInput).max(50) });
export type ReplaceHoursInput = z.infer<typeof ReplaceHoursInput>;

/** Rango guardado: nunca cruza la medianoche (`opensAt < closesAt`). */
export const HoursRangeDto = z
  .strictObject({ weekday: Weekday, opensAt: OpensAt, closesAt: ClosesAt })
  .meta({ id: "HoursRangeDto" });
export type HoursRangeDto = z.infer<typeof HoursRangeDto>;

/** Semana de la sucursal ordenada por día y hora de apertura. */
export const BranchHoursDto = z
  .strictObject({ ranges: z.array(HoursRangeDto) })
  .meta({ id: "BranchHoursDto" });
export type BranchHoursDto = z.infer<typeof BranchHoursDto>;

export const BranchDetailDto = BranchDto.extend({ hours: z.array(HoursRangeDto) }).meta({
  id: "BranchDetailDto",
});
export type BranchDetailDto = z.infer<typeof BranchDetailDto>;
