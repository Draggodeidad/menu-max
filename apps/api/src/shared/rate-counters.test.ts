import { emailDomainChecks, rateCounters } from "@menu-max/database";
import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getEnv } from "../env";
import worker from "../index";
import { createDb } from "../infrastructure/db";
import { deleteExpiredRateCounters, hit, peek } from "./rate-counters";

const db = () => createDb(getEnv(env));
const MINUTE = 60_000;
// Inicio de una ventana de 1 min, para que las pruebas no dependan del reloj.
const T0 = 1_800_000_000_000 - (1_800_000_000_000 % MINUTE);
const uniqueKey = () => `prueba:${crypto.randomUUID()}`;

describe("hit", () => {
  it("permite exactamente `limit` llamadas en la ventana y la siguiente no", async () => {
    const key = uniqueKey();
    const allowed = await Promise.all([1, 2, 3].map((ms) => hit(db(), key, MINUTE, 3, T0 + ms)));
    expect(allowed.every((result) => result.allowed && result.retryAfterMs === 0)).toBe(true);
    expect(new Set(allowed.map((result) => result.remaining))).toEqual(new Set([0, 1, 2]));

    expect(await hit(db(), key, MINUTE, 3, T0 + 10_000)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 50_000,
    });
  });

  it("no mezcla dos ventanas distintas", async () => {
    const key = uniqueKey();
    await hit(db(), key, MINUTE, 1, T0);
    expect((await hit(db(), key, MINUTE, 1, T0 + 1)).allowed).toBe(false);

    expect((await hit(db(), key, MINUTE, 1, T0 + MINUTE)).allowed).toBe(true);
    const rows = await db().select().from(rateCounters).where(eq(rateCounters.key, key));
    expect(
      rows.map(({ windowStart, count, expiresAt }) => [windowStart, count, expiresAt]),
    ).toEqual([
      [T0, 2, T0 + MINUTE],
      [T0 + MINUTE, 1, T0 + 2 * MINUTE],
    ]);
  });

  it("no mezcla llaves distintas", async () => {
    const [a, b] = [uniqueKey(), uniqueKey()];
    await hit(db(), a, MINUTE, 1, T0);
    expect((await hit(db(), b, MINUTE, 1, T0)).allowed).toBe(true);
  });

  it("cuenta bien llamadas simultáneas", async () => {
    const key = uniqueKey();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => hit(db(), key, MINUTE, 5, T0)),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(5);
  });
});

describe("peek", () => {
  it("consulta la cuota sin contar la llamada", async () => {
    const key = uniqueKey();
    expect(await peek(db(), key, MINUTE, 2, T0)).toEqual({
      allowed: true,
      remaining: 2,
      retryAfterMs: 0,
    });

    await hit(db(), key, MINUTE, 2, T0);
    await hit(db(), key, MINUTE, 2, T0);
    expect(await peek(db(), key, MINUTE, 2, T0 + 15_000)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 45_000,
    });
    expect(await peek(db(), key, MINUTE, 2, T0 + 15_000)).toMatchObject({ allowed: false });
  });
});

describe("Cron diario", () => {
  it("borra los contadores vencidos y los chequeos de dominio de más de 7 días", async () => {
    const now = Date.now();
    const [expired, current] = [uniqueKey(), uniqueKey()];
    await hit(db(), expired, MINUTE, 5, now - 2 * MINUTE);
    await hit(db(), current, MINUTE, 5, now);
    const day = 24 * 60 * MINUTE;
    const [stale, fresh] = [`viejo-${crypto.randomUUID()}.mx`, `nuevo-${crypto.randomUUID()}.mx`];
    await db()
      .insert(emailDomainChecks)
      .values([
        { domain: stale, hasMail: true, checkedAt: now - 8 * day },
        { domain: fresh, hasMail: true, checkedAt: now - 2 * day },
      ]);

    await worker.scheduled(
      createScheduledController({ scheduledTime: now, cron: "0 9 * * *" }),
      env,
    );

    const keys = await db()
      .select({ key: rateCounters.key })
      .from(rateCounters)
      .where(inArray(rateCounters.key, [expired, current]));
    expect(keys).toEqual([{ key: current }]);
    const domains = await db()
      .select({ domain: emailDomainChecks.domain })
      .from(emailDomainChecks)
      .where(inArray(emailDomainChecks.domain, [stale, fresh]));
    expect(domains).toEqual([{ domain: fresh }]);
  });

  it("deleteExpiredRateCounters devuelve cuántas filas borró", async () => {
    const key = uniqueKey();
    await hit(db(), key, MINUTE, 5, T0);
    expect(await deleteExpiredRateCounters(db(), T0 + MINUTE)).toBeGreaterThanOrEqual(1);
    expect((await peek(db(), key, MINUTE, 5, T0)).remaining).toBe(5);
  });
});
