import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getEnv, type Env as ApiEnv } from "./env";
import type * as worker from "./index";

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof worker;
    }
    interface Env extends ApiEnv {}
  }
}

const validToken = "x".repeat(32);
// Doble mínimo de un binding D1: getEnv solo verifica la forma.
const fakeDb = { prepare: () => null };

describe("GET /v1/health", () => {
  it("responde 200 con el entorno", async () => {
    const response = await exports.default.fetch("http://api.internal/v1/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      environment: env.ENVIRONMENT,
      db: "ok",
    });
  });
});

describe("getEnv", () => {
  it("acepta una configuración válida", () => {
    expect(getEnv({ ENVIRONMENT: "production", INTERNAL_TOKEN: validToken, DB: fakeDb })).toEqual({
      ENVIRONMENT: "production",
      INTERNAL_TOKEN: validToken,
      DB: fakeDb,
    });
  });

  it("lanza un error claro si falta INTERNAL_TOKEN", () => {
    expect(() => getEnv({ ENVIRONMENT: "development", DB: fakeDb })).toThrow(/INTERNAL_TOKEN/);
  });

  it("lanza un error si INTERNAL_TOKEN tiene menos de 32 caracteres", () => {
    expect(() =>
      getEnv({ ENVIRONMENT: "development", INTERNAL_TOKEN: "x".repeat(31), DB: fakeDb }),
    ).toThrow(/INTERNAL_TOKEN/);
  });

  it("no incluye el valor del secreto en el mensaje", () => {
    expect(() =>
      getEnv({ ENVIRONMENT: "development", INTERNAL_TOKEN: "secreto-corto", DB: fakeDb }),
    ).toThrow(expect.not.objectContaining({ message: expect.stringContaining("secreto-corto") }));
  });

  it("lanza un error claro si falta el binding DB", () => {
    expect(() => getEnv({ ENVIRONMENT: "development", INTERNAL_TOKEN: validToken })).toThrow(/DB/);
  });

  it("rechaza un ENVIRONMENT desconocido", () => {
    expect(() => getEnv({ ENVIRONMENT: "local", INTERNAL_TOKEN: validToken, DB: fakeDb })).toThrow(
      /ENVIRONMENT/,
    );
  });
});
