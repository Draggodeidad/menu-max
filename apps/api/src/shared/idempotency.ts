import { IDEMPOTENCY_KEY_HEADER, IdempotencyKey } from "@menu-max/contracts";
import { idempotencyKeys } from "@menu-max/database";
import { and, eq, lte } from "drizzle-orm";
import type { Db } from "../infrastructure/db";
import { AppError } from "./errors";

// Idempotencia por `Idempotency-Key` (ADR-013). La respuesta se guarda en el mismo `db.batch` que
// el efecto, así que una llave registrada implica que el efecto ocurrió una sola vez.

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const INVALID_KEY = "Envía un Idempotency-Key con formato UUID.";

/** Valor del header `Idempotency-Key`: un UUID. Si falta o es inválido → `VALIDATION_FAILED`. */
export function parseIdempotencyKey(value: string | undefined): string {
  const parsed = IdempotencyKey.safeParse(value);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", INVALID_KEY, {
      [IDEMPOTENCY_KEY_HEADER]: [INVALID_KEY],
    });
  }
  return parsed.data;
}

export type StoredResponse = { statusCode: number; body: unknown };

/** JSON con las llaves ordenadas: el mismo cuerpo da el mismo texto sin importar el orden. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const fields = entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * SHA-256 hex de `scope` y del cuerpo canónico. Quien llama decide qué entra en `payload`: nunca
 * contraseñas (un hash rápido no las protege) y, si la llave no debe compartirse entre usuarios,
 * el id de quien la usa.
 */
export async function requestHash(scope: string, payload: unknown): Promise<string> {
  const text = canonicalJson({ scope, payload });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Respuesta guardada para la llave, si sigue vigente. Misma llave con otro `scope` o con otro
 * cuerpo → `IDEMPOTENCY_CONFLICT`.
 */
export async function findStoredResponse(
  db: Db,
  key: string,
  scope: string,
  hash: string,
  now = Date.now(),
): Promise<StoredResponse | undefined> {
  const row = await db
    .select({
      scope: idempotencyKeys.scope,
      requestHash: idempotencyKeys.requestHash,
      statusCode: idempotencyKeys.statusCode,
      body: idempotencyKeys.responseJson,
      expiresAt: idempotencyKeys.expiresAt,
    })
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, key))
    .get();
  if (!row || row.expiresAt <= now) return undefined;
  if (row.scope !== scope || row.requestHash !== hash) throw new AppError("IDEMPOTENCY_CONFLICT");
  return { statusCode: row.statusCode, body: row.body };
}

export type IdempotencyRecord = {
  key: string;
  orgId: string;
  scope: string;
  hash: string;
  response: StoredResponse;
  now?: number;
};

/**
 * Sentencias para el `db.batch` del efecto: liberan la llave si ya venció y la registran con su
 * respuesta. Si otra petición la registró a la vez, el batch completo falla (llave primaria):
 * vuelve a consultar con `findStoredResponse`.
 */
export function storeResponseStatements(db: Db, record: IdempotencyRecord) {
  const now = record.now ?? Date.now();
  return [
    db
      .delete(idempotencyKeys)
      .where(and(eq(idempotencyKeys.key, record.key), lte(idempotencyKeys.expiresAt, now))),
    db.insert(idempotencyKeys).values({
      key: record.key,
      organizationId: record.orgId,
      scope: record.scope,
      requestHash: record.hash,
      statusCode: record.response.statusCode,
      responseJson: record.response.body,
      expiresAt: now + IDEMPOTENCY_TTL_MS,
    }),
  ] as const;
}

/** Borra las llaves vencidas. Lo llama el Cron diario. */
export async function deleteExpiredIdempotencyKeys(db: Db, now = Date.now()): Promise<number> {
  const { meta } = await db.delete(idempotencyKeys).where(lte(idempotencyKeys.expiresAt, now));
  return meta.changes;
}
