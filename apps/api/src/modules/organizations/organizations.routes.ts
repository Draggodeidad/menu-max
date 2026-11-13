import { ErrorResponse, OrganizationDto } from "@menu-max/contracts";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import type { ZodType } from "zod";
import { createDb } from "../../infrastructure/db";
import type { TenantEnv } from "../../types";
import { getOrganization } from "./organizations.service";

function jsonResponse(description: string, schema: ZodType) {
  return { description, content: { "application/json": { schema: resolver(schema) } } };
}

/** Respuestas comunes de toda ruta bajo `/v1/orgs/:orgId`. */
export const orgScopedResponses = {
  401: jsonResponse("La sesión falta o ya no es válida.", ErrorResponse),
  404: jsonResponse(
    "La organización no existe o no eres miembro activo. Sin token interno, la respuesta no tiene cuerpo.",
    ErrorResponse,
  ),
  429: jsonResponse(
    "Demasiadas peticiones desde esta IP. Espera los segundos del header Retry-After.",
    ErrorResponse,
  ),
  500: jsonResponse("Ocurrió un error interno.", ErrorResponse),
};

export const orgIdParameter = {
  name: "orgId",
  in: "path",
  required: true,
  description: "Id (UUIDv7) de la organización.",
  schema: { type: "string", format: "uuid" },
} as const;

// Se monta en `orgScoped`, que ya aplicó `requireAuth` y `requireMembership()`.
export const organizationRoutes = new Hono<TenantEnv>().get(
  "/",
  describeRoute({
    tags: ["Organizaciones"],
    summary: "Consultar una organización y mi rol en ella",
    security: [{ InternalToken: [], SessionCookie: [] }],
    parameters: [orgIdParameter],
    responses: {
      200: jsonResponse("Organización y rol del usuario en ella.", OrganizationDto),
      ...orgScopedResponses,
    },
  }),
  async (c) => c.json(await getOrganization(createDb(c.env), c.var.tenant)),
);
