import { ErrorResponse, SubscriptionDto } from "@menu-max/contracts";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { createDb } from "../../infrastructure/db";
import { requirePermission } from "../../middleware/authz";
import type { TenantEnv } from "../../types";
import { orgIdParameter, orgScopedResponses } from "../organizations/organizations.routes";
import { getSubscription } from "./subscriptions.service";

// Se monta en `orgScoped` (`/v1/orgs/:orgId/subscription`), que ya aplicó `requireAuth`,
// `requireMembership()` y `requireOperable()`.
export const subscriptionRoutes = new Hono<TenantEnv>().get(
  "/",
  describeRoute({
    tags: ["Suscripción"],
    summary: "Consultar el plan, sus límites y el uso actual",
    description:
      "Solo el dueño. Con la suscripción `suspended`, la organización solo admite lecturas: toda escritura privada responde 403.",
    security: [{ InternalToken: [], SessionCookie: [] }],
    parameters: [orgIdParameter],
    responses: {
      200: {
        description: "Plan, estado, límites y uso actual de la organización.",
        content: { "application/json": { schema: resolver(SubscriptionDto) } },
      },
      403: {
        description: "Solo el dueño consulta la suscripción.",
        content: { "application/json": { schema: resolver(ErrorResponse) } },
      },
      ...orgScopedResponses,
    },
  }),
  requirePermission("subscription:read"),
  async (c) =>
    c.json(
      await getSubscription({
        db: createDb(c.env),
        tenant: c.var.tenant,
        requestId: c.var.requestId,
      }),
    ),
);
