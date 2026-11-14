import {
  BranchDetailDto,
  BranchDto,
  BranchHoursDto,
  BranchListDto,
  BranchParams,
  BusinessDto,
  CreateBranchInput,
  CursorQuery,
  ErrorResponse,
  ReplaceHoursInput,
  UpdateBranchInput,
  UpdateBusinessInput,
} from "@menu-max/contracts";
import { Hono, type Context } from "hono";
import { describeRoute, validator } from "hono-openapi";
import { createDb } from "../../infrastructure/db";
import { requirePermission } from "../../middleware/authz";
import { requireBranch } from "../../middleware/tenant";
import type { TenantEnv } from "../../types";
import {
  jsonResponse,
  orgIdParameter,
  orgScopedResponses,
  rejectWith,
  routeParam,
} from "../organizations/organizations.routes";
import {
  createBranch,
  getBranch,
  getBusiness,
  listBranches,
  replaceHours,
  updateBranch,
  updateBusiness,
  type BusinessDeps,
} from "./businesses.service";

function deps(c: Context<TenantEnv>): BusinessDeps {
  return { db: createDb(c.env), tenant: c.var.tenant, requestId: c.var.requestId };
}

function branchId(c: Context<TenantEnv>) {
  return routeParam(BranchParams, "branchId", c.req.param("branchId"));
}

const branchIdParameter = {
  name: "branchId",
  in: "path",
  required: true,
  description: "Id (UUIDv7) de la sucursal.",
  schema: { type: "string", format: "uuid" },
} as const;

const privateSecurity = [{ InternalToken: [], SessionCookie: [] }];
const invalidInput = jsonResponse("Datos inválidos.", ErrorResponse);
const forbidden = jsonResponse(
  "Tu rol no tiene el permiso, o la suscripción está suspendida y solo admite lecturas.",
  ErrorResponse,
);
const branchNotFound = jsonResponse(
  "La organización o la sucursal no existen, o la sucursal no está asignada a tu cuenta.",
  ErrorResponse,
);

// Se monta en `orgScoped` (`/v1/orgs/:orgId/business`), que ya aplicó `requireAuth`,
// `requireMembership()` y `requireOperable()`.
export const businessRoutes = new Hono<TenantEnv>()
  .get(
    "/",
    describeRoute({
      tags: ["Negocio"],
      summary: "Consultar el negocio",
      security: privateSecurity,
      parameters: [orgIdParameter],
      responses: {
        200: jsonResponse("Negocio de la organización.", BusinessDto),
        ...orgScopedResponses,
      },
    }),
    requirePermission("settings:read"),
    async (c) => c.json(await getBusiness(deps(c))),
  )
  .patch(
    "/",
    describeRoute({
      tags: ["Negocio"],
      summary: "Cambiar el nombre del negocio",
      security: privateSecurity,
      parameters: [orgIdParameter],
      responses: {
        200: jsonResponse("Negocio actualizado.", BusinessDto),
        400: invalidInput,
        403: forbidden,
        ...orgScopedResponses,
      },
    }),
    requirePermission("settings:write"),
    validator("json", UpdateBusinessInput, rejectWith(UpdateBusinessInput)),
    async (c) => c.json(await updateBusiness(deps(c), c.req.valid("json"))),
  );

// Se monta en `orgScoped` (`/v1/orgs/:orgId/branches`).
export const branchRoutes = new Hono<TenantEnv>()
  .get(
    "/",
    describeRoute({
      tags: ["Sucursales"],
      summary: "Listar las sucursales",
      description: "Paginadas por cursor. El personal (`staff`) solo ve sus sucursales asignadas.",
      security: privateSecurity,
      parameters: [orgIdParameter],
      responses: {
        200: jsonResponse("Página de sucursales.", BranchListDto),
        400: invalidInput,
        ...orgScopedResponses,
      },
    }),
    requirePermission("settings:read"),
    validator("query", CursorQuery, rejectWith(CursorQuery)),
    async (c) => c.json(await listBranches(deps(c), c.req.valid("query"))),
  )
  .post(
    "/",
    describeRoute({
      tags: ["Sucursales"],
      summary: "Crear una sucursal",
      description:
        "Respeta el límite de sucursales del plan. Al menos una modalidad activa; si atiende en mesa, al menos una mesa. Guardar `alertWhatsapp` confirma que el número acepta avisos.",
      security: privateSecurity,
      parameters: [orgIdParameter],
      responses: {
        201: jsonResponse("Sucursal creada.", BranchDto),
        400: invalidInput,
        402: jsonResponse("El plan ya no admite otra sucursal.", ErrorResponse),
        403: forbidden,
        ...orgScopedResponses,
      },
    }),
    requirePermission("branches:manage"),
    validator("json", CreateBranchInput, rejectWith(CreateBranchInput)),
    async (c) => c.json(await createBranch(deps(c), c.req.valid("json")), 201),
  )
  .get(
    "/:branchId",
    describeRoute({
      tags: ["Sucursales"],
      summary: "Consultar una sucursal con su horario",
      security: privateSecurity,
      parameters: [orgIdParameter, branchIdParameter],
      responses: {
        200: jsonResponse("Sucursal y su semana de horarios.", BranchDetailDto),
        ...orgScopedResponses,
        404: branchNotFound,
      },
    }),
    requirePermission("settings:read"),
    requireBranch(),
    async (c) => c.json(await getBranch(deps(c), branchId(c))),
  )
  .patch(
    "/:branchId",
    describeRoute({
      tags: ["Sucursales"],
      summary: "Editar una sucursal",
      description:
        "Cambios parciales con `version` obligatorio. `null` borra un valor opcional. Cambiar `alertWhatsapp` por otro número vuelve a registrar la confirmación de avisos.",
      security: privateSecurity,
      parameters: [orgIdParameter, branchIdParameter],
      responses: {
        200: jsonResponse("Sucursal actualizada.", BranchDto),
        400: invalidInput,
        403: forbidden,
        ...orgScopedResponses,
        404: branchNotFound,
        409: jsonResponse(
          "La sucursal cambió desde que la leíste (`version` vieja). Vuelve a leerla.",
          ErrorResponse,
        ),
      },
    }),
    requirePermission("settings:write"),
    requireBranch(),
    validator("json", UpdateBranchInput, rejectWith(UpdateBranchInput)),
    async (c) => c.json(await updateBranch(deps(c), branchId(c), c.req.valid("json"))),
  )
  .put(
    "/:branchId/hours",
    describeRoute({
      tags: ["Sucursales"],
      summary: "Reemplazar el horario de la semana",
      description:
        "Reemplaza todos los rangos en un solo paso. Horas locales de la sucursal (`HH:MM`); si `opensAt` es mayor que `closesAt`, el rango cruza la medianoche y se guarda partido en dos días. Rangos que se enciman el mismo día → 400.",
      security: privateSecurity,
      parameters: [orgIdParameter, branchIdParameter],
      responses: {
        200: jsonResponse(
          "Semana guardada, con los rangos ya partidos y ordenados.",
          BranchHoursDto,
        ),
        400: invalidInput,
        403: forbidden,
        ...orgScopedResponses,
        404: branchNotFound,
      },
    }),
    requirePermission("settings:write"),
    requireBranch(),
    validator("json", ReplaceHoursInput, rejectWith(ReplaceHoursInput)),
    async (c) => c.json(await replaceHours(deps(c), branchId(c), c.req.valid("json"))),
  );
