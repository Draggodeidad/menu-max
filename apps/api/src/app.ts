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
import { requestId } from "./middleware/request-id";
import { AppError, notFound, onError } from "./shared/errors";
import type { AppEnv } from "./types";

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
