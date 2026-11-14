import {
  BranchDetailDto,
  BranchDto,
  BranchHoursDto,
  BranchListDto,
  BranchParams,
  BusinessDto,
  CreateBranchInput,
  CreateDeliveryZoneInput,
  CursorQuery,
  DeliveryZoneDto,
  DeliveryZoneListDto,
  ErrorResponse,
  ReplaceHoursInput,
  UpdateBranchInput,
  UpdateBusinessInput,
  UpdateDeliveryZoneInput,
  ZoneParams,
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
  createZone,
  deleteZone,
  getBranch,
  getBusiness,
  listBranches,
  listZones,
  replaceHours,
  updateBranch,
  updateBusiness,
  updateZone,
  type BusinessDeps,
} from "./businesses.service";

function deps(c: Context<TenantEnv>): BusinessDeps {
  return { db: createDb(c.env), tenant: c.var.tenant, requestId: c.var.requestId };
}

function branchId(c: Context<TenantEnv>) {
  return routeParam(BranchParams, "branchId", c.req.param("branchId"));
}

function zoneId(c: Context<TenantEnv>) {
  return routeParam(ZoneParams, "zoneId", c.req.param("zoneId"));
}

const zoneIdParameter = {
  name: "zoneId",
  in: "path",
  required: true,
  description: "Id (UUIDv7) de la zona de entrega.",
  schema: { type: "string", format: "uuid" },
} as const;

export const branchIdParameter = {
  name: "branchId",
  in: "path",
  required: true,
  description: "Id (UUIDv7) de la sucursal.",
  schema: { type: "string", format: "uuid" },
} as const;

export const privateSecurity = [{ InternalToken: [], SessionCookie: [] }];
export const invalidInput = jsonResponse("Datos inválidos.", ErrorResponse);
export const forbidden = jsonResponse(
  "Tu rol no tiene el permiso, o la suscripción está suspendida y solo admite lecturas.",
  ErrorResponse,
);
const zoneNotFound = jsonResponse(
  "La organización, la sucursal o la zona no existen (o la zona ya se borró).",
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
  )
  .get(
    "/:branchId/zones",
    describeRoute({
      tags: ["Zonas de entrega"],
      summary: "Listar las zonas de entrega de una sucursal",
      description: "Zonas no borradas, activas y pausadas, con sus códigos postales (ADR-018).",
      security: privateSecurity,
      parameters: [orgIdParameter, branchIdParameter],
      responses: {
        200: jsonResponse("Zonas de la sucursal.", DeliveryZoneListDto),
        ...orgScopedResponses,
        404: branchNotFound,
      },
    }),
    requirePermission("settings:read"),
    requireBranch(),
    async (c) => c.json(await listZones(deps(c), branchId(c))),
  )
  .post(
    "/:branchId/zones",
    describeRoute({
      tags: ["Zonas de entrega"],
      summary: "Crear una zona de entrega",
      description:
        "Códigos postales de 5 dígitos y tarifa fija en centavos (`0` = envío gratis). Un código no puede estar en dos zonas activas de la misma sucursal. Hasta 20 zonas por sucursal.",
      security: privateSecurity,
      parameters: [orgIdParameter, branchIdParameter],
      responses: {
        201: jsonResponse("Zona creada.", DeliveryZoneDto),
        400: invalidInput,
        403: forbidden,
        ...orgScopedResponses,
        404: branchNotFound,
        409: jsonResponse(
          "Algún código postal ya está en otra zona activa de la sucursal (detalle en `fieldErrors.postalCodes`).",
          ErrorResponse,
        ),
        422: jsonResponse("La sucursal ya tiene 20 zonas.", ErrorResponse),
      },
    }),
    requirePermission("settings:write"),
    requireBranch(),
    validator("json", CreateDeliveryZoneInput, rejectWith(CreateDeliveryZoneInput)),
    async (c) => c.json(await createZone(deps(c), branchId(c), c.req.valid("json")), 201),
  )
  .patch(
    "/:branchId/zones/:zoneId",
    describeRoute({
      tags: ["Zonas de entrega"],
      summary: "Editar, pausar o reactivar una zona de entrega",
      description:
        "Cambios parciales con `version` obligatorio. `postalCodes` reemplaza la lista completa. Reactivar una zona revisa que sus códigos no estén en otra zona activa.",
      security: privateSecurity,
      parameters: [orgIdParameter, branchIdParameter, zoneIdParameter],
      responses: {
        200: jsonResponse("Zona actualizada.", DeliveryZoneDto),
        400: invalidInput,
        403: forbidden,
        ...orgScopedResponses,
        404: zoneNotFound,
        409: jsonResponse(
          "`version` vieja, o algún código postal ya está en otra zona activa.",
          ErrorResponse,
        ),
      },
    }),
    requirePermission("settings:write"),
    requireBranch(),
    validator("json", UpdateDeliveryZoneInput, rejectWith(UpdateDeliveryZoneInput)),
    async (c) => c.json(await updateZone(deps(c), branchId(c), zoneId(c), c.req.valid("json"))),
  )
  .delete(
    "/:branchId/zones/:zoneId",
    describeRoute({
      tags: ["Zonas de entrega"],
      summary: "Borrar una zona de entrega",
      description:
        "Borrado lógico: deja de atender y de aparecer, pero los pedidos que la usaron la conservan.",
      security: privateSecurity,
      parameters: [orgIdParameter, branchIdParameter, zoneIdParameter],
      responses: {
        204: { description: "Zona borrada." },
        403: forbidden,
        ...orgScopedResponses,
        404: zoneNotFound,
      },
    }),
    requirePermission("settings:write"),
    requireBranch(),
    async (c) => {
      await deleteZone(deps(c), branchId(c), zoneId(c));
      return c.body(null, 204);
    },
  );
