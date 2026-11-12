import { ErrorResponse, HealthResponse } from "@menu-max/contracts";
import { createExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp } from "./app";
import { getEnv, type Env as ApiEnv } from "./env";
import * as worker from "./index";
import { AppError } from "./shared/errors";

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof worker;
    }
    interface Env extends ApiEnv {}
  }
}

const validToken = "x".repeat(32);
const forwardedId = "1e88c238-9a58-494f-8909-a60eb3bb763e";
const internalHeaders = () => ({ "x-mm-internal": env.INTERNAL_TOKEN });

async function expectApiError(response: Response, status: number, code: ErrorResponse["code"]) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const error = ErrorResponse.parse(await response.json());
  expect(error.code).toBe(code);
  expect(error.requestId).toBe(response.headers.get("x-request-id"));
  expect(z.uuid().safeParse(error.requestId).success).toBe(true);
  return error;
}

// Doble mínimo de un binding D1: getEnv solo verifica la forma.
const fakeDb = { prepare: () => null };

describe("GET /v1/health", () => {
  it("responde 200 con el entorno", async () => {
    const response = await exports.default.fetch("http://api.internal/v1/health", {
      headers: { ...internalHeaders(), "x-request-id": forwardedId },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(forwardedId);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(HealthResponse.parse(await response.json())).toEqual({
      status: "ok",
      environment: env.ENVIRONMENT,
      db: "ok",
    });
  });

  it.each([undefined, "incorrecto"])("responde 404 vacío con token %s", async (token) => {
    const response = await exports.default.fetch("http://api.internal/v1/health", {
      headers: token === undefined ? {} : { "x-mm-internal": token },
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(z.uuid().safeParse(response.headers.get("x-request-id")).success).toBe(true);
    expect(await response.text()).toBe("");
  });

  it("responde 404 vacío si falla un token de la longitud correcta", async () => {
    const invalidToken = env.INTERNAL_TOKEN.replace(/.$/, (last) => (last === "x" ? "y" : "x"));
    const response = await exports.default.fetch("http://api.internal/v1/health", {
      headers: { "x-mm-internal": invalidToken },
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});

describe("documentación de la API", () => {
  it("sirve Scalar sin token en desarrollo", async () => {
    const response = await exports.default.fetch("http://api.internal/docs");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("/openapi.json");
  });

  it("genera OpenAPI 3.1 con el esquema de salud y el error reutilizable", async () => {
    const response = await exports.default.fetch("http://api.internal/openapi.json");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const document: unknown = await response.json();
    expect(document).toMatchObject({
      openapi: expect.stringMatching(/^3\.1\.\d+$/),
      paths: {
        "/v1/health": {
          get: {
            security: [{ InternalToken: [] }],
            responses: {
              200: {
                content: {
                  "application/json": {
                    schema: { type: "object", required: ["status", "environment", "db"] },
                  },
                },
              },
              500: {
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: { ErrorResponse: { required: ["code", "message", "requestId"] } },
        securitySchemes: {
          InternalToken: { type: "apiKey", in: "header", name: "x-mm-internal" },
        },
      },
    });
    expect(document).not.toHaveProperty(["paths", "/docs"]);
    expect(document).not.toHaveProperty(["paths", "/openapi.json"]);
  });

  describe.each(["staging", "production"])("%s", (environment) => {
    it.each(["/docs", "/openapi.json"])("responde 404 en %s con y sin token", async (path) => {
      const bindings = { ...env, ENVIRONMENT: environment };
      const url = `http://api.internal${path}`;
      const [response, authenticated] = await Promise.all([
        worker.default.fetch(new Request(url), bindings, createExecutionContext()),
        worker.default.fetch(
          new Request(url, { headers: internalHeaders() }),
          bindings,
          createExecutionContext(),
        ),
      ]);

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
      await expectApiError(authenticated, 404, "NOT_FOUND");
    });
  });
});

describe("middlewares base", () => {
  it("reemplaza un requestId inválido y devuelve NOT_FOUND con el id nuevo", async () => {
    const response = await exports.default.fetch("http://api.internal/v1/inexistente", {
      headers: { ...internalHeaders(), "x-request-id": "id-invalido" },
    });

    await expectApiError(response, 404, "NOT_FOUND");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("guarda x-client-ip y user-agent en el contexto", async () => {
    const app = createApp();
    app.get("/context", (c) => c.json({ ip: c.var.clientIp, agent: c.var.userAgent }));

    const response = await app.request(
      "/context",
      {
        headers: { ...internalHeaders(), "x-client-ip": "192.0.2.10", "user-agent": "Prueba" },
      },
      env,
    );
    expect(await response.json()).toEqual({ ip: "192.0.2.10", agent: "Prueba" });
  });

  it.each([true, false])("aplica el límite de 64 KB con content-length=%s", async (withLength) => {
    const app = createApp();
    app.post("/body", async (c) => c.text(String((await c.req.arrayBuffer()).byteLength)));
    const maxBytes = 64 * 1024;
    const send = (bytes: number) =>
      app.request(
        "/body",
        {
          method: "POST",
          headers: {
            ...internalHeaders(),
            ...(withLength ? { "content-length": String(bytes) } : {}),
          },
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(bytes - 1));
              controller.enqueue(new Uint8Array(1));
              controller.close();
            },
          }),
        },
        env,
      );

    const atLimit = await send(maxBytes);
    expect(atLimit.status).toBe(200);
    expect(await atLimit.text()).toBe(String(maxBytes));
    await expectApiError(await send(maxBytes + 1), 413, "PAYLOAD_TOO_LARGE");
  });
});

describe("manejo de errores", () => {
  it("devuelve el estado del catálogo y conserva el mensaje y los campos de AppError", async () => {
    const app = createApp();
    const message = "El valor ya existe. Elige otro.";
    const fieldErrors = { name: ["Ya está en uso."] };
    app.get("/conflict", () => {
      throw new AppError("CONFLICT", message, fieldErrors);
    });

    const response = await app.request(
      "/conflict",
      { headers: { ...internalHeaders(), "x-request-id": forwardedId } },
      env,
    );
    expect(await expectApiError(response, 409, "CONFLICT")).toEqual({
      code: "CONFLICT",
      message,
      requestId: forwardedId,
      fieldErrors,
    });
  });

  it("devuelve errores de validación en español sin reflejar llaves desconocidas", async () => {
    const app = createApp();
    const schema = z.strictObject({ name: z.string() });
    app.get("/validation", (c) => c.json(schema.parse({ name: 123, secretField: true })));

    const response = await app.request("/validation", { headers: internalHeaders() }, env);
    const error = await expectApiError(response, 400, "VALIDATION_FAILED");
    expect(error.fieldErrors).toEqual({ name: ["Revisa este valor."], "": ["Revisa este valor."] });
  });

  it("registra los marcos del error sin exponer el mensaje ni el stack en la respuesta", async () => {
    const app = createApp();
    const diagnostic =
      "SELECT * FROM accounts; cookie=valor-privado\n    at otra línea del mensaje";
    app.get("/unexpected", () => {
      throw new Error(diagnostic);
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await app.request("/unexpected", { headers: internalHeaders() }, env);
      const error = await expectApiError(response, 500, "INTERNAL");
      const logEntry = String(consoleError.mock.calls[0]?.[0]);

      expect(error.message).toBe("Ocurrió un problema. Inténtalo de nuevo en unos momentos.");
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(JSON.parse(logEntry)).toMatchObject({
        event: "http.unexpected_error",
        requestId: error.requestId,
        stack: expect.stringContaining("at "),
      });
      expect(logEntry).not.toMatch(/accounts|valor-privado|otra línea/);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("getEnv", () => {
  const authVars = {
    BETTER_AUTH_SECRET: "test".repeat(12),
    WEB_ORIGIN: "https://menusmax.example",
  };

  it("acepta una configuración válida", () => {
    const bindings = {
      ENVIRONMENT: "production",
      INTERNAL_TOKEN: validToken,
      DB: fakeDb,
      ...authVars,
    };
    expect(getEnv(bindings)).toEqual(bindings);
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
    expect(() =>
      getEnv({ ENVIRONMENT: "development", INTERNAL_TOKEN: validToken, ...authVars }),
    ).toThrow(/DB/);
  });

  it("valida el origen de WEB y la longitud del secreto de autenticación", () => {
    expect(() =>
      getEnv({
        ENVIRONMENT: "development",
        INTERNAL_TOKEN: validToken,
        DB: fakeDb,
        BETTER_AUTH_SECRET: "corto",
        WEB_ORIGIN: "https://menusmax.example/entrar",
      }),
    ).toThrow(/BETTER_AUTH_SECRET.*WEB_ORIGIN/);
  });

  it("rechaza un ENVIRONMENT desconocido", () => {
    expect(() => getEnv({ ENVIRONMENT: "local", INTERNAL_TOKEN: validToken, DB: fakeDb })).toThrow(
      /ENVIRONMENT/,
    );
  });
});
