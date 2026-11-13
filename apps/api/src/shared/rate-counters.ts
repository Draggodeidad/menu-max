import { rateCounters } from "@menu-max/database";
import { and, eq, lte, sql } from "drizzle-orm";
import type { Db } from "../infrastructure/db";

// Cuotas exactas en D1 con ventana fija (ADR-010). El binding `ratelimits` es solo filtro grueso.

export type RateResult = {
  allowed: boolean;
  remaining: number;
  /** Milisegundos hasta que cierra la ventana; `0` si la llamada se permitió. */
  retryAfterMs: number;
};

function windowFor(windowMs: number, now: number) {
  const start = Math.floor(now / windowMs) * windowMs;
  return { start, end: start + windowMs };
}

function result(count: number, limit: number, allowed: boolean, end: number, now: number) {
  return {
    allowed,
    remaining: Math.max(0, limit - count),
    retryAfterMs: allowed ? 0 : end - now,
  } satisfies RateResult;
}

/**
 * Cuenta una llamada y dice si cabe en la cuota. El upsert es atómico: dos peticiones
 * simultáneas nunca leen el mismo `count`. La llave no debe llevar datos personales en claro.
 */
export async function hit(
  db: Db,
  key: string,
  windowMs: number,
  limit: number,
  now = Date.now(),
): Promise<RateResult> {
  const { start, end } = windowFor(windowMs, now);
  const [row] = await db
    .insert(rateCounters)
    .values({ key, windowStart: start, count: 1, expiresAt: end })
    .onConflictDoUpdate({
      target: [rateCounters.key, rateCounters.windowStart],
      set: { count: sql`${rateCounters.count} + 1` },
    })
    .returning({ count: rateCounters.count });
  const count = row?.count ?? 1;
  return result(count, limit, count <= limit, end, now);
}

/** Consulta la cuota sin contar la llamada: `allowed` indica si la siguiente `hit` cabría. */
export async function peek(
  db: Db,
  key: string,
  windowMs: number,
  limit: number,
  now = Date.now(),
): Promise<RateResult> {
  const { start, end } = windowFor(windowMs, now);
  const row = await db
    .select({ count: rateCounters.count })
    .from(rateCounters)
    .where(and(eq(rateCounters.key, key), eq(rateCounters.windowStart, start)))
    .get();
  const count = row?.count ?? 0;
  return result(count, limit, count < limit, end, now);
}

/** Borra los contadores cuya ventana ya cerró. Lo llama el Cron diario. */
export async function deleteExpiredRateCounters(db: Db, now = Date.now()): Promise<number> {
  const { meta } = await db.delete(rateCounters).where(lte(rateCounters.expiresAt, now));
  return meta.changes;
}
