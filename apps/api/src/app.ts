import { ErrorResponse, HealthResponse } from "@menu-max/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { describeRoute, resolver } from "hono-openapi";
import { registerDocs } from "./docs";
import type { Env } from "./env";
import { createDb, pingDb } from "./infrastructure/db";
import { clientContext } from "./middleware/client-context";
import { internal } from "./middleware/internal";
import { rateLimit, type RateLimitGroup } from "./middleware/rate-limit";
import { requestId } from "./middleware/request-id";
import { session } from "./middleware/session";
import { AUTH_BASE_PATH } from "./modules/auth/auth";
import { authRoutes, meRoutes } from "./modules/auth/auth.routes";
import { AppError, notFound, onError } from "./shared/errors";
import type { AppEnv } from "./types";

function routeGroup(path: string): RateLimitGroup {
  const under = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  if (under(AUTH_BASE_PATH)) return "auth";
  if (under("/v1/public")) return "public";
  return "private";
}

export function createApp(environment?: Env["ENVIRONMENT"]) {
  const app = new Hono<AppEnv>();

  app.onError(onError);
  app.notFound(notFound);
  app.use("*", requestId);
  if (environment === "development") registerDocs(app);

  app.use(
    "*",
    internal,
    clientContext,
    bodyLimit({
      maxSize: 64 * 1024,
      onError: () => {
        throw new AppError("PAYLOAD_TOO_LARGE");
      },
    }),
    secureHeaders(),
  );

  const limiters = {
    auth: rateLimit("auth"),
    public: rateLimit("public"),
    private: rateLimit("private"),
  } satisfies Record<RateLimitGroup, unknown>;
  app.use("*", (c, next) => limiters[routeGroup(c.req.path)](c, next));

  // Better Auth resuelve su propia sesión y emite las cookies de estas rutas.
  app.route(AUTH_BASE_PATH, authRoutes);
  app.use("*", session);
  app.route("/v1", meRoutes);

  app.get(
    "/v1/health",
    describeRoute({
      tags: ["Sistema"],
      summary: "Consultar el estado de la API",
      security: [{ InternalToken: [] }],
      responses: {
        200: {
          description: "La API y la base de datos responden correctamente.",
          content: { "application/json": { schema: resolver(HealthResponse) } },
        },
        404: { description: "El token interno falta o es inválido. La respuesta no tiene cuerpo." },
        429: {
          description:
            "Demasiadas peticiones desde esta IP. Espera los segundos del header Retry-After.",
          content: { "application/json": { schema: resolver(ErrorResponse) } },
        },
        500: {
          description: "Ocurrió un error interno.",
          content: { "application/json": { schema: resolver(ErrorResponse) } },
        },
      },
    }),
    async (c) => {
      await pingDb(createDb(c.env));
      const health: HealthResponse = { status: "ok", environment: c.env.ENVIRONMENT, db: "ok" };
      return c.json(health);
    },
  );

  return app;
}
