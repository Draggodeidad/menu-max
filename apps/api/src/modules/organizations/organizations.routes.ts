import {
  AcceptInvitationDto,
  AcceptInvitationInput,
  CreateInvitationInput,
  CursorQuery,
  ErrorResponse,
  InvitationDto,
  InvitationListDto,
  InvitationParams,
  InvitationPreviewDto,
  InvitationTokenParams,
  MemberDto,
  MemberListDto,
  MemberParams,
  OrganizationDto,
  UpdateMemberInput,
} from "@menu-max/contracts";
import { Hono, type Context } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import type { ZodType } from "zod";
import { createDb } from "../../infrastructure/db";
import { TURNSTILE_HEADER } from "../../infrastructure/turnstile";
import { requirePermission, requireVerifiedEmail } from "../../middleware/authz";
import { AppError } from "../../shared/errors";
import type { AppEnv, TenantEnv } from "../../types";
import {
  acceptInvitation,
  createInvitation,
  getOrganization,
  listInvitations,
  listMembers,
  previewInvitation,
  removeMember,
  revokeInvitation,
  updateMember,
  type OrgDeps,
} from "./organizations.service";

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

function deps(c: Context<TenantEnv>): OrgDeps {
  return {
    db: createDb(c.env),
    env: c.env,
    tenant: c.var.tenant,
    actor: c.var.user,
    requestId: c.var.requestId,
  };
}

/**
 * Hook de `validator`: ante datos inválidos vuelve a validar con Zod y deja que `onError` arme
 * `VALIDATION_FAILED` con `fieldErrors`, igual que en el resto de la API.
 */
function rejectWith(schema: ZodType) {
  return (result: { success: boolean; data: unknown }) => {
    if (!result.success) schema.parse(result.data);
  };
}

/** Id de la ruta con formato inválido → `NOT_FOUND`: el recurso no existe para quien pregunta. */
function routeParam<K extends string>(
  schema: ZodType<Record<K, string>>,
  key: K,
  value: string | undefined,
): string {
  const parsed = schema.safeParse({ [key]: value });
  if (!parsed.success) throw new AppError("NOT_FOUND");
  return parsed.data[key];
}

const memberIdParameter = {
  name: "memberId",
  in: "path",
  required: true,
  description: "Id (UUIDv7) del miembro.",
  schema: { type: "string", format: "uuid" },
} as const;

const invitationIdParameter = {
  name: "invitationId",
  in: "path",
  required: true,
  description: "Id (UUIDv7) de la invitación.",
  schema: { type: "string", format: "uuid" },
} as const;

const tokenParameter = {
  name: "token",
  in: "path",
  required: true,
  description: "Token de la invitación (43 caracteres base64url) tal como llega en el enlace.",
  schema: { type: "string" },
} as const;

const privateSecurity = [{ InternalToken: [], SessionCookie: [] }];
const invalidInput = jsonResponse("Datos inválidos.", ErrorResponse);
const forbidden = jsonResponse(
  "Tu rol no tiene el permiso o la política lo impide (p. ej., un administrador sobre un dueño).",
  ErrorResponse,
);
const lastOwner = jsonResponse(
  "La organización se quedaría sin dueño. Asigna otro dueño antes de continuar.",
  ErrorResponse,
);

// Se monta en `orgScoped`, que ya aplicó `requireAuth` y `requireMembership()`.
export const organizationRoutes = new Hono<TenantEnv>()
  .get(
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
    requirePermission("organization:read"),
    async (c) => c.json(await getOrganization(createDb(c.env), c.var.tenant)),
  )
  .get(
    "/members",
    describeRoute({
      tags: ["Miembros"],
      summary: "Listar los miembros activos",
      description:
        "Miembros con rol y sucursales asignadas, paginados por cursor. Si consulta un `staff`, los correos van enmascarados.",
      security: privateSecurity,
      parameters: [orgIdParameter],
      responses: {
        200: jsonResponse("Página de miembros.", MemberListDto),
        400: invalidInput,
        ...orgScopedResponses,
      },
    }),
    requirePermission("organization:read"),
    validator("query", CursorQuery, rejectWith(CursorQuery)),
    async (c) => c.json(await listMembers(deps(c), c.req.valid("query"))),
  )
  .patch(
    "/members/:memberId",
    describeRoute({
      tags: ["Miembros"],
      summary: "Cambiar el rol o las sucursales de un miembro",
      description:
        "Un administrador solo gestiona `staff` y solo asigna `staff`. `staff` necesita al menos una sucursal; los demás roles no llevan sucursales.",
      security: privateSecurity,
      parameters: [orgIdParameter, memberIdParameter],
      responses: {
        200: jsonResponse("Miembro actualizado.", MemberDto),
        400: invalidInput,
        403: forbidden,
        422: lastOwner,
        ...orgScopedResponses,
      },
    }),
    requirePermission("members:manage"),
    validator("json", UpdateMemberInput, rejectWith(UpdateMemberInput)),
    async (c) => {
      const memberId = routeParam(MemberParams, "memberId", c.req.param("memberId"));
      return c.json(await updateMember(deps(c), memberId, c.req.valid("json")));
    },
  )
  .delete(
    "/members/:memberId",
    describeRoute({
      tags: ["Miembros"],
      summary: "Quitar a un miembro",
      description: "Marca la membresía como removida y borra sus sucursales asignadas.",
      security: privateSecurity,
      parameters: [orgIdParameter, memberIdParameter],
      responses: {
        204: { description: "Miembro removido." },
        403: forbidden,
        422: lastOwner,
        ...orgScopedResponses,
      },
    }),
    requirePermission("members:manage"),
    async (c) => {
      await removeMember(deps(c), routeParam(MemberParams, "memberId", c.req.param("memberId")));
      return c.body(null, 204);
    },
  )
  .post(
    "/invitations",
    describeRoute({
      tags: ["Miembros"],
      summary: "Invitar a alguien por correo",
      description:
        "Requiere correo verificado. Cuota de 20 por día (UTC) por organización. Si ya había una invitación pendiente para ese correo, se revoca y se envía la nueva.",
      security: privateSecurity,
      parameters: [orgIdParameter],
      responses: {
        201: jsonResponse("Invitación creada; el correo sale por la cola.", InvitationDto),
        400: invalidInput,
        403: jsonResponse(
          "Correo sin verificar, rol sin permiso o un administrador que invita a un dueño o administrador.",
          ErrorResponse,
        ),
        409: jsonResponse("Esa persona ya es miembro de la organización.", ErrorResponse),
        ...orgScopedResponses,
        429: jsonResponse(
          "Se excedió la cuota de 20 invitaciones por día, o demasiadas peticiones. Espera los segundos del header Retry-After.",
          ErrorResponse,
        ),
      },
    }),
    requireVerifiedEmail(),
    requirePermission("members:manage"),
    validator("json", CreateInvitationInput, rejectWith(CreateInvitationInput)),
    async (c) => c.json(await createInvitation(deps(c), c.req.valid("json")), 201),
  )
  .get(
    "/invitations",
    describeRoute({
      tags: ["Miembros"],
      summary: "Listar las invitaciones pendientes",
      description: "Sin aceptar ni revocar, de la más nueva a la más vieja; incluye las vencidas.",
      security: privateSecurity,
      parameters: [orgIdParameter],
      responses: {
        200: jsonResponse("Página de invitaciones.", InvitationListDto),
        400: invalidInput,
        403: forbidden,
        ...orgScopedResponses,
      },
    }),
    requirePermission("members:manage"),
    validator("query", CursorQuery, rejectWith(CursorQuery)),
    async (c) => c.json(await listInvitations(deps(c), c.req.valid("query"))),
  )
  .delete(
    "/invitations/:invitationId",
    describeRoute({
      tags: ["Miembros"],
      summary: "Revocar una invitación pendiente",
      description: "Un administrador solo revoca invitaciones de `staff`.",
      security: privateSecurity,
      parameters: [orgIdParameter, invitationIdParameter],
      responses: {
        204: { description: "Invitación revocada." },
        403: forbidden,
        ...orgScopedResponses,
      },
    }),
    requirePermission("members:manage"),
    async (c) => {
      const invitationId = routeParam(
        InvitationParams,
        "invitationId",
        c.req.param("invitationId"),
      );
      await revokeInvitation(deps(c), invitationId);
      return c.body(null, 204);
    },
  );

const tooManyRequests = jsonResponse(
  "Demasiadas peticiones desde esta IP. Espera los segundos del header Retry-After.",
  ErrorResponse,
);
const invitationGone = jsonResponse(
  "El token interno falta (sin cuerpo) o la invitación no existe, ya se aceptó o se revocó.",
  ErrorResponse,
);

/** Rutas públicas de invitación (`/v1/public`): el token es la credencial. */
export const publicInvitationRoutes = new Hono<AppEnv>()
  .get(
    "/invitations/:token",
    describeRoute({
      tags: ["Invitaciones"],
      summary: "Ver una invitación por su token",
      security: [{ InternalToken: [] }],
      parameters: [tokenParameter],
      responses: {
        200: jsonResponse(
          "Organización, rol y correo enmascarado de la invitación.",
          InvitationPreviewDto,
        ),
        404: invitationGone,
        429: tooManyRequests,
        500: jsonResponse("Ocurrió un error interno.", ErrorResponse),
      },
    }),
    async (c) => {
      const token = routeParam(InvitationTokenParams, "token", c.req.param("token"));
      return c.json(await previewInvitation(createDb(c.env), token));
    },
  )
  .post(
    "/invitations/:token/accept",
    describeRoute({
      tags: ["Invitaciones"],
      summary: "Aceptar una invitación",
      description:
        "Con sesión: el correo de la sesión debe ser el invitado; cuerpo vacío. Sin sesión y sin cuenta: `{ name, password }` y Turnstile en `x-turnstile-token`; crea la cuenta ya verificada y abre la sesión (Set-Cookie). Sin sesión y con cuenta: 401.",
      security: [{ InternalToken: [] }, { InternalToken: [], SessionCookie: [] }],
      parameters: [
        tokenParameter,
        {
          name: TURNSTILE_HEADER,
          in: "header",
          required: false,
          description: "Token de Turnstile de un solo uso. Obligatorio sin sesión.",
          schema: { type: "string" },
        },
      ],
      responses: {
        200: jsonResponse(
          "Membresía creada. Sin sesión previa, incluye la cookie de sesión.",
          AcceptInvitationDto,
        ),
        400: jsonResponse(
          "Datos inválidos, contraseña filtrada o Turnstile rechazado.",
          ErrorResponse,
        ),
        401: jsonResponse("El correo ya tiene cuenta: entra con ella para aceptar.", ErrorResponse),
        404: invitationGone,
        409: jsonResponse(
          "La invitación ya se usó, es para otro correo o ya eres miembro.",
          ErrorResponse,
        ),
        422: jsonResponse("La invitación venció o se canceló.", ErrorResponse),
        429: tooManyRequests,
        500: jsonResponse("Ocurrió un error interno.", ErrorResponse),
      },
    }),
    validator("json", AcceptInvitationInput, rejectWith(AcceptInvitationInput)),
    async (c) => {
      const token = routeParam(InvitationTokenParams, "token", c.req.param("token"));
      const { setCookies, ...result } = await acceptInvitation(
        {
          db: createDb(c.env),
          env: c.env,
          requestId: c.var.requestId,
          clientIp: c.var.clientIp,
          user: c.var.user,
          headers: c.req.raw.headers,
        },
        token,
        c.req.valid("json"),
      );
      for (const cookie of setCookies) c.header("Set-Cookie", cookie, { append: true });
      return c.json(result);
    },
  );
