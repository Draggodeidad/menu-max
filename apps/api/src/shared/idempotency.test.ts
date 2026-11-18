import { idempotencyKeys } from "@menu-max/database";
import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createOrg, createUser } from "../../test/factories";
import { getEnv } from "../env";
import { createDb } from "../infrastructure/db";
import worker from "../index";
import { AppError } from "./errors";
import {
  IDEMPOTENCY_TTL_MS,
  findStoredResponse,
  requestHash,
  storeResponseStatements,
} from "./idempotency";

const db = () => createDb(getEnv(env));
const T0 = Date.UTC(2026, 10, 17, 12);

async function store(key: string, hash: string, now: number) {
  const owner = await createUser();
  const { orgId } = await createOrg({ ownerId: owner.id });
  const database = db();
  await database.batch(
    storeResponseStatements(database, {
      key,
      orgId,
      scope: "prueba",
      hash,
      response: { statusCode: 201, body: { ok: true } },
      now,
    }),
  );
  return orgId;
}

describe("requestHash", () => {
  it("no depende del orden de las llaves ni de las llaves sin valor", async () => {
    const a = await requestHash("onboarding", { b: 1, a: { y: [1, 2], x: "z" }, c: undefined });
    const b = await requestHash("onboarding", { a: { x: "z", y: [1, 2] }, b: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[\da-f]{64}$/);
  });

  it("cambia con el scope, con un valor o con el orden de una lista", async () => {
    const base = await requestHash("onboarding", { a: [1, 2] });
    expect(await requestHash("public-order", { a: [1, 2] })).not.toBe(base);
    expect(await requestHash("onboarding", { a: [1, 3] })).not.toBe(base);
    expect(await requestHash("onboarding", { a: [2, 1] })).not.toBe(base);
  });
});

describe("findStoredResponse", () => {
  it("devuelve la respuesta guardada con la misma llave y el mismo hash", async () => {
    const key = crypto.randomUUID();
    await store(key, "hash-a", T0);
    expect(await findStoredResponse(db(), key, "prueba", "hash-a", T0 + 1000)).toEqual({
      statusCode: 201,
      body: { ok: true },
    });
  });

  it("otro hash u otro scope con la misma llave → IDEMPOTENCY_CONFLICT", async () => {
    const key = crypto.randomUUID();
    await store(key, "hash-a", T0);
    const errors = await Promise.all(
      [
        ["prueba", "hash-b"],
        ["otro", "hash-a"],
      ].map(([scope = "", hash = ""]) =>
        findStoredResponse(db(), key, scope, hash, T0).catch((error: unknown) => error),
      ),
    );
    for (const error of errors) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("IDEMPOTENCY_CONFLICT");
    }
  });

  it("una llave vencida no cuenta y se puede volver a registrar", async () => {
    const key = crypto.randomUUID();
    await store(key, "hash-a", T0);
    const later = T0 + IDEMPOTENCY_TTL_MS;
    expect(await findStoredResponse(db(), key, "prueba", "hash-b", later)).toBeUndefined();
    await store(key, "hash-b", later);
    expect(await findStoredResponse(db(), key, "prueba", "hash-b", later)).toBeDefined();
  });

  it("registrar una llave vigente dos veces hace fallar el batch completo", async () => {
    const key = crypto.randomUUID();
    await store(key, "hash-a", T0);
    await expect(store(key, "hash-a", T0 + 1000)).rejects.toThrow();
  });
});

describe("Cron diario", () => {
  it("borra las llaves vencidas y conserva las vigentes", async () => {
    const now = Date.now();
    const [expired, current] = [crypto.randomUUID(), crypto.randomUUID()];
    await store(expired, "hash", now - IDEMPOTENCY_TTL_MS - 1);
    await store(current, "hash", now);

    await worker.scheduled(
      createScheduledController({ scheduledTime: now, cron: "0 9 * * *" }),
      env,
    );

    const rows = await db()
      .select({ key: idempotencyKeys.key })
      .from(idempotencyKeys)
      .where(inArray(idempotencyKeys.key, [expired, current]));
    expect(rows).toEqual([{ key: current }]);
  });
});
