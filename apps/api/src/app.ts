import { ErrorResponse, HealthResponse, MAX_MEDIA_BYTES } from "@menu-max/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { describeRoute, resolver } from "hono-openapi";
import { registerDocs } from "./docs";
import type { Env } from "./env";
import { createDb, pingDb } from "./infrastructure/db";
import { clientContext } from "./middleware/client-context";
import { internal } from "./middleware/internal";
import { requireOperable } from "./middleware/authz";
import { rateLimit, type RateLimitGroup } from "./middleware/rate-limit";
import { requestId } from "./middleware/request-id";
import { requireAuth } from "./middleware/require-auth";
import { session } from "./middleware/session";
import { requireMembership } from "./middleware/tenant";
import { AUTH_BASE_PATH } from "./modules/auth/auth";
import { authRoutes, meRoutes } from "./modules/auth/auth.routes";
import { branchRoutes, businessRoutes } from "./modules/businesses/businesses.routes";
import { catalogRoutes } from "./modules/catalog/catalog.routes";
import { mediaRoutes } from "./modules/catalog/media.routes";
import {
  organizationRoutes,
  publicInvitationRoutes,
} from "./modules/organizations/organizations.routes";
import { subscriptionRoutes } from "./modules/subscriptions/subscriptions.routes";
import { AppError, notFound, onError } from "./shared/errors";
import type { AppEnv, TenantEnv } from "./types";

const DEFAULT_BODY_LIMIT = bodyLimit({
  maxSize: 64 * 1024,
  onError: () => {
    throw new AppError("PAYLOAD_TOO_LARGE");
  },
});

// Subida de imágenes (T17): el único cuerpo que puede pasar de 64 KB.
const MEDIA_BODY_LIMIT = bodyLimit({
  maxSize: MAX_MEDIA_BYTES,
  onError: () => {
    throw new AppError(
      "PAYLOAD_TOO_LARGE",
      "La imagen pesa más de 5 MB. Redúcela o comprímela e inténtalo de nuevo.",
    );
  },
});

const MEDIA_UPLOAD_PATH = /^\/v1\/orgs\/[^/]+\/media\/?$/;

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
    (c, next) =>
      c.req.method === "POST" && MEDIA_UPLOAD_PATH.test(c.req.path)
        ? MEDIA_BODY_LIMIT(c, next)
        : DEFAULT_BODY_LIMIT(c, next),
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
  // Sin sesión obligatoria: el token, Turnstile y las cuotas protegen estas rutas.
  app.route("/v1/public", publicInvitationRoutes);

  // Tenant explícito en la ruta (ADR-006): todo lo de abajo exige sesión y membresía activa, y
  // con la suscripción suspendida solo admite lecturas (T14).
  const orgScoped = new Hono<TenantEnv>().use(requireAuth, requireMembership(), requireOperable());
  orgScoped.route("/", organizationRoutes);
  orgScoped.route("/subscription", subscriptionRoutes);
  orgScoped.route("/business", businessRoutes);
  orgScoped.route("/branches", branchRoutes);
  orgScoped.route("/branches/:branchId/menu", catalogRoutes);
  orgScoped.route("/media", mediaRoutes);
  app.route("/v1/orgs/:orgId", orgScoped);

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
