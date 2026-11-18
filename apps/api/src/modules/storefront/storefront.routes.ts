import {
  BranchParams,
  ErrorResponse,
  MenuPublicationDto,
  PublicMenuDto,
  PublicMenuParams,
  PublicMenuVersionDto,
  ThemeDto,
  UpdateSlugInput,
  UpdateThemeInput,
} from "@menu-max/contracts";
import { Hono, type Context } from "hono";
import { describeRoute, validator } from "hono-openapi";
import { createDb } from "../../infrastructure/db";
import { requirePermission } from "../../middleware/authz";
import { requireBranch } from "../../middleware/tenant";
import type { AppEnv, TenantEnv } from "../../types";
import {
  branchIdParameter,
  forbidden,
  invalidInput,
  privateSecurity,
} from "../businesses/businesses.routes";
import {
  jsonResponse,
  orgIdParameter,
  orgScopedResponses,
  rejectWith,
  routeParam,
} from "../organizations/organizations.routes";
import {
  changeSlug,
  getPublicMenu,
  getPublicMenuVersion,
  getTheme,
  publish,
  unpublish,
  updateTheme,
  type PublicStorefrontDeps,
  type StorefrontDeps,
} from "./storefront.service";

function deps(c: Context<TenantEnv>): StorefrontDeps {
  return { db: createDb(c.env), env: c.env, tenant: c.var.tenant, requestId: c.var.requestId };
}

function publicDeps(c: Context<AppEnv>): PublicStorefrontDeps {
  return { db: createDb(c.env), env: c.env, requestId: c.var.requestId };
}

function branchId(c: Context<TenantEnv>) {
  return routeParam(BranchParams, "branchId", c.req.param("branchId"));
}

function slug(c: Context<AppEnv>) {
  return routeParam(PublicMenuParams, "slug", c.req.param("slug"));
}

const branchParameters = [orgIdParameter, branchIdParameter];
const tags = ["Menú público"];
const menuNotFound = jsonResponse(
  "La organización o la sucursal no existen, o la sucursal no está asignada a tu cuenta.",
  ErrorResponse,
);
const publicNotFound = jsonResponse(
  "No hay un menú publicado con ese enlace (no existe o está en borrador).",
  ErrorResponse,
);
const tooManyRequests = jsonResponse(
  "Demasiadas peticiones desde esta IP. Espera los segundos del header Retry-After.",
  ErrorResponse,
);
const internalError = jsonResponse("Ocurrió un error interno.", ErrorResponse);

const slugParameter = {
  name: "slug",
  in: "path",
  required: true,
  description: "Enlace del menú (p. ej. `tacos-el-guero`).",
  schema: { type: "string" },
} as const;

// Se monta en `orgScoped` (`/v1/orgs/:orgId/branches/:branchId/menu`), que ya aplicó
// `requireAuth`, `requireMembership()` y `requireOperable()`. Junto a las rutas del catálogo.
export const storefrontRoutes = new Hono<TenantEnv>()
  .get(
    "/theme",
    describeRoute({
      tags,
      summary: "Consultar el tema del menú",
      description:
        "Tema guardado. Un color en `null` sigue al preset. Si nunca se ha guardado, responde el tema por defecto con `version: 0`.",
      security: privateSecurity,
      parameters: branchParameters,
      responses: {
        200: jsonResponse("Tema del menú.", ThemeDto),
        ...orgScopedResponses,
        404: menuNotFound,
      },
    }),
    requirePermission("settings:read"),
    requireBranch(),
    async (c) => c.json(await getTheme(deps(c), branchId(c))),
  )
  .put(
    "/theme",
    describeRoute({
      tags,
      summary: "Guardar el tema del menú",
      description:
        "Lo omitido se conserva; `null` en un color o una imagen vuelve al preset o la quita. Con la `version` leída (`0` si nunca se guardó). Valida contraste AA (4.5:1) del color principal y del texto sobre el fondo. Sin `customTheme` (plan `free`) solo acepta `preset` y `primaryColor`; `showBranding: false` exige `removeBranding`. Sube `menuVersion`.",
      security: privateSecurity,
      parameters: branchParameters,
      responses: {
        200: jsonResponse("Tema guardado.", ThemeDto),
        400: jsonResponse(
          "Datos inválidos o colores sin contraste suficiente; `fieldErrors` dice qué color cambiar.",
          ErrorResponse,
        ),
        402: jsonResponse(
          "El plan no incluye la personalización enviada (`customTheme` o `removeBranding`).",
          ErrorResponse,
        ),
        403: forbidden,
        ...orgScopedResponses,
        404: jsonResponse(
          "La organización, la sucursal o la imagen del logo o la portada no existen (o la imagen ya se borró).",
          ErrorResponse,
        ),
        409: jsonResponse(
          "El tema cambió desde que lo leíste (`version` vieja). Vuelve a leerlo.",
          ErrorResponse,
        ),
      },
    }),
    requirePermission("settings:write"),
    requireBranch(),
    validator("json", UpdateThemeInput, rejectWith(UpdateThemeInput)),
    async (c) => c.json(await updateTheme(deps(c), branchId(c), c.req.valid("json"))),
  )
  .patch(
    "/slug",
    describeRoute({
      tags,
      summary: "Cambiar el enlace del menú",
      description:
        "Solo mientras el menú nunca se ha publicado: después el enlace ya está en QR impresos (422). No admite enlaces reservados.",
      security: privateSecurity,
      parameters: branchParameters,
      responses: {
        200: jsonResponse("Enlace actualizado.", MenuPublicationDto),
        400: invalidInput,
        403: forbidden,
        ...orgScopedResponses,
        404: menuNotFound,
        409: jsonResponse("Otro menú ya usa ese enlace.", ErrorResponse),
        422: jsonResponse("El menú ya se publicó alguna vez; el enlace no cambia.", ErrorResponse),
      },
    }),
    requirePermission("settings:write"),
    requireBranch(),
    validator("json", UpdateSlugInput, rejectWith(UpdateSlugInput)),
    async (c) => c.json(await changeSlug(deps(c), branchId(c), c.req.valid("json"))),
  )
  .post(
    "/publish",
    describeRoute({
      tags,
      summary: "Publicar el menú",
      description:
        "Requiere al menos un producto disponible. No exige correo verificado (ADR-008): sin un dueño verificado el menú se ve, pero no recibe pedidos (`acceptingOrders: false`). Sube `menuVersion`; si ya estaba publicado, no cambia nada.",
      security: privateSecurity,
      parameters: branchParameters,
      responses: {
        200: jsonResponse("Menú publicado.", MenuPublicationDto),
        403: forbidden,
        ...orgScopedResponses,
        404: menuNotFound,
        422: jsonResponse("El menú no tiene productos disponibles.", ErrorResponse),
      },
    }),
    requirePermission("storefront:publish"),
    requireBranch(),
    async (c) => c.json(await publish(deps(c), branchId(c))),
  )
  .post(
    "/unpublish",
    describeRoute({
      tags,
      summary: "Despublicar el menú",
      description:
        "El menú vuelve a borrador y el público deja de verlo. Sube `menuVersion`; el enlace sigue fijo. Si ya estaba en borrador, no cambia nada.",
      security: privateSecurity,
      parameters: branchParameters,
      responses: {
        200: jsonResponse("Menú en borrador.", MenuPublicationDto),
        403: forbidden,
        ...orgScopedResponses,
        404: menuNotFound,
      },
    }),
    requirePermission("storefront:publish"),
    requireBranch(),
    async (c) => c.json(await unpublish(deps(c), branchId(c))),
  );

// Se monta en `/v1/public/menus`: sin sesión, con el rate limit `public`.
export const publicMenuRoutes = new Hono<AppEnv>()
  .get(
    "/:slug",
    describeRoute({
      tags,
      summary: "Leer un menú publicado",
      description:
        "Solo datos publicables: negocio, sucursal, horario de hoy, modalidades, zonas (nombre y tarifa), tema efectivo según el plan, y categorías con productos disponibles. `acceptingOrders` dice si recibe pedidos y `notAcceptingReason`, por qué no.",
      security: [{ InternalToken: [] }],
      parameters: [slugParameter],
      responses: {
        200: jsonResponse("Menú publicado.", PublicMenuDto),
        404: publicNotFound,
        429: tooManyRequests,
        500: internalError,
      },
    }),
    async (c) => c.json(await getPublicMenu(publicDeps(c), slug(c))),
  )
  .get(
    "/:slug/version",
    describeRoute({
      tags,
      summary: "Consultar la versión de un menú publicado",
      description:
        "Lectura mínima para la llave de caché `menu:{slug}:v{menuVersion}` en WEB (ADR-014).",
      security: [{ InternalToken: [] }],
      parameters: [slugParameter],
      responses: {
        200: jsonResponse("Versión del menú.", PublicMenuVersionDto),
        404: publicNotFound,
        429: tooManyRequests,
        500: internalError,
      },
    }),
    async (c) => c.json(await getPublicMenuVersion(publicDeps(c), slug(c))),
  );
