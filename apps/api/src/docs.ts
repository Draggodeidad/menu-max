import { Scalar } from "@scalar/hono-api-reference";
import type { Hono } from "hono";
import { openAPIRouteHandler } from "hono-openapi";
import type { AppEnv } from "./types";

export function registerDocs(app: Hono<AppEnv>) {
  app.get(
    "/openapi.json",
    openAPIRouteHandler(app, {
      documentation: {
        info: {
          title: "API de MenusMax",
          version: "1.0.0",
          description: "Referencia de la API privada de MenusMax para desarrollo local.",
        },
        components: {
          securitySchemes: {
            InternalToken: { type: "apiKey", in: "header", name: "x-mm-internal" },
          },
        },
      },
    }),
  );
  app.get("/docs", Scalar({ url: "/openapi.json", pageTitle: "API de MenusMax" }));
}
