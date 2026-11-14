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

// Dobles mínimos de bindings: getEnv solo verifica la forma.
const fakeDb = { prepare: () => null };
const fakeQueue = { send: () => null, sendBatch: () => null };
const fakeRateLimit = { limit: () => null };
const fakeBucket = { put: () => null, delete: () => null };

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

// IP única por prueba: el binding de miniflare conserva sus contadores durante la corrida.
const randomIp = () =>
  `2001:db8::${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}`;
const fromIp = (ip: string, path: string) =>
  exports.default.fetch(`http://api.internal${path}`, {
    headers: { ...internalHeaders(), "x-client-ip": ip },
  });
const repeat = <T>(count: number, call: () => Promise<T>) =>
  Promise.all(Array.from({ length: count }, call));

describe("rate limit por grupo", () => {
  it("responde 429 con Retry-After al pasar el límite de auth, solo para esa IP y ese grupo", async () => {
    const ip = randomIp();
    const allowed = await repeat(10, () => fromIp(ip, "/v1/auth/get-session"));
    expect(allowed.map((response) => response.status)).toEqual(Array(10).fill(200));

    const limited = await fromIp(ip, "/v1/auth/get-session");
    const error = await expectApiError(limited, 429, "RATE_LIMITED");
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(error.message).toMatch(/Espera/);

    expect((await fromIp(randomIp(), "/v1/auth/get-session")).status).toBe(200);
    expect((await fromIp(ip, "/v1/health")).status).toBe(200);
  });

  it("usa el grupo público para /v1/public y el privado para lo demás", async () => {
    const ip = randomIp();
    await repeat(60, () => fromIp(ip, "/v1/public/no-existe"));
    await expectApiError(await fromIp(ip, "/v1/public/no-existe"), 429, "RATE_LIMITED");
    await expectApiError(await fromIp(ip, "/v1/no-existe"), 404, "NOT_FOUND");
  });
});

describe("getEnv", () => {
  const authVars = {
    BETTER_AUTH_SECRET: "test".repeat(12),
    WEB_ORIGIN: "https://menusmax.example",
  };
  const validBindings = {
    ENVIRONMENT: "production",
    INTERNAL_TOKEN: validToken,
    DB: fakeDb,
    ...authVars,
    EMAIL_FROM: "MenusMax <no-responder@menusmax.example>",
    RESEND_API_KEY: "resend-test-placeholder",
    JOBS: fakeQueue,
    JOBS_DLQ: fakeQueue,
    TURNSTILE_SECRET_KEY: "turnstile-test-placeholder",
    RL_AUTH: fakeRateLimit,
    RL_PUBLIC: fakeRateLimit,
    RL_PRIVATE: fakeRateLimit,
    MEDIA_PUBLIC_BASE_URL: "https://img.menusmax.example",
    MEDIA: fakeBucket,
  };

  it("acepta una configuración válida", () => {
    expect(getEnv(validBindings)).toEqual(validBindings);
  });

  it("vuelve a aceptar su propia salida", () => {
    expect(getEnv({ ...getEnv(validBindings) })).toEqual(validBindings);
  });

  it.each(["no-responder@menusmax.example", "MenusMax <no-responder@menusmax.example>"])(
    "acepta EMAIL_FROM con o sin nombre (%s)",
    (emailFrom) => {
      expect(getEnv({ ...validBindings, EMAIL_FROM: emailFrom }).EMAIL_FROM).toBe(emailFrom);
    },
  );

  it.each(["", "MenusMax", "MenusMax <no-responder>", "a <b@c.mx> <d@e.mx>"])(
    "rechaza EMAIL_FROM mal formado (caso %#)",
    (emailFrom) => {
      expect(() => getEnv({ ...validBindings, EMAIL_FROM: emailFrom })).toThrow(/EMAIL_FROM/);
    },
  );

  it.each(["JOBS", "JOBS_DLQ", "RL_AUTH", "RL_PUBLIC", "RL_PRIVATE", "MEDIA"])(
    "lanza un error claro si falta el binding %s",
    (name) => {
      const { [name as "JOBS"]: _missing, ...rest } = validBindings;
      expect(() => getEnv(rest)).toThrow(new RegExp(`${name}:`));
    },
  );

  it.each([undefined, ""])(
    "lanza un error claro si falta TURNSTILE_SECRET_KEY (caso %#)",
    (key) => {
      expect(() => getEnv({ ...validBindings, TURNSTILE_SECRET_KEY: key })).toThrow(
        /TURNSTILE_SECRET_KEY/,
      );
    },
  );

  it.each([
    undefined,
    "",
    "img.menusmax.example",
    "https://img.menusmax.example/",
    "https://img.menusmax.example?v=1",
    "ftp://img.menusmax.example",
  ])("rechaza MEDIA_PUBLIC_BASE_URL faltante o mal formada (caso %#)", (url) => {
    expect(() => getEnv({ ...validBindings, MEDIA_PUBLIC_BASE_URL: url })).toThrow(
      /MEDIA_PUBLIC_BASE_URL/,
    );
  });

  it("acepta MEDIA_PUBLIC_BASE_URL con ruta, sin diagonal final", () => {
    const url = "https://cdn.menusmax.example/media";
    expect(getEnv({ ...validBindings, MEDIA_PUBLIC_BASE_URL: url }).MEDIA_PUBLIC_BASE_URL).toBe(
      url,
    );
  });

  it.each([undefined, ""])("lanza un error claro si falta RESEND_API_KEY (caso %#)", (key) => {
    expect(() => getEnv({ ...validBindings, RESEND_API_KEY: key })).toThrow(/RESEND_API_KEY/);
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

  it.each(["https://menusmax.example/entrar", "origen-invalido", ""])(
    "valida el origen de WEB y la longitud del secreto de autenticación (caso %#)",
    (origin) => {
      expect(() =>
        getEnv({
          ENVIRONMENT: "development",
          INTERNAL_TOKEN: validToken,
          DB: fakeDb,
          BETTER_AUTH_SECRET: "corto",
          WEB_ORIGIN: origin,
        }),
      ).toThrow(/BETTER_AUTH_SECRET.*WEB_ORIGIN/);
    },
  );

  it("rechaza un ENVIRONMENT desconocido", () => {
    expect(() => getEnv({ ENVIRONMENT: "local", INTERNAL_TOKEN: validToken, DB: fakeDb })).toThrow(
      /ENVIRONMENT/,
    );
  });
});
