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

describe("GET /v1/health", () => {
  it("responde 200 con el entorno", async () => {
    const response = await exports.default.fetch("http://api.internal/v1/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", environment: env.ENVIRONMENT });
  });
});

describe("getEnv", () => {
  it("acepta una configuración válida", () => {
    expect(getEnv({ ENVIRONMENT: "production", INTERNAL_TOKEN: validToken })).toEqual({
      ENVIRONMENT: "production",
      INTERNAL_TOKEN: validToken,
    });
  });

  it("lanza un error claro si falta INTERNAL_TOKEN", () => {
    expect(() => getEnv({ ENVIRONMENT: "development" })).toThrow(/INTERNAL_TOKEN/);
  });

  it("lanza un error si INTERNAL_TOKEN tiene menos de 32 caracteres", () => {
    expect(() => getEnv({ ENVIRONMENT: "development", INTERNAL_TOKEN: "x".repeat(31) })).toThrow(
      /INTERNAL_TOKEN/,
    );
  });

  it("no incluye el valor del secreto en el mensaje", () => {
    expect(() => getEnv({ ENVIRONMENT: "development", INTERNAL_TOKEN: "secreto-corto" })).toThrow(
      expect.not.objectContaining({ message: expect.stringContaining("secreto-corto") }),
    );
  });

  it("rechaza un ENVIRONMENT desconocido", () => {
    expect(() => getEnv({ ENVIRONMENT: "local", INTERNAL_TOKEN: validToken })).toThrow(
      /ENVIRONMENT/,
    );
  });
});
