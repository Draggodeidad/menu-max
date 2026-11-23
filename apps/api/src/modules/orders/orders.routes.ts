import {
  BranchParams,
  ErrorResponse,
  IDEMPOTENCY_KEY_HEADER,
  OrderCreatedDto,
  OrderDetailDto,
  OrderInput,
  OrderListDto,
  OrderListQuery,
  OrderParams,
  OrderTransitionInput,
  PublicOrderDto,
} from "@menu-max/contracts";
import { Hono, type Context } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import { createDb } from "../../infrastructure/db";
import { TURNSTILE_HEADER } from "../../infrastructure/turnstile";
import { requirePermission } from "../../middleware/authz";
import { requireBranch } from "../../middleware/tenant";
import { parseIdempotencyKey } from "../../shared/idempotency";
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
  createOrder,
  getOrder,
  getTrackedOrder,
  listOrders,
  transitionOrder,
  type OrderPanelDeps,
} from "./orders.service";

/**
 * `POST /v1/public/orders` (T21): pedido del comensal como invitado. Sin sesión obligatoria: lo
 * protegen la llave de idempotencia, Turnstile y las cuotas. Con sesión de un miembro de la
 * organización, el pedido queda como prueba (`is_test`).
 */
export const publicOrderRoutes = new Hono<AppEnv>()
  .post(
    "/",
    describeRoute({
      tags: ["Pedidos"],
      summary: "Crear un pedido como invitado",
      description:
        "La API calcula precios, envío y total con el catálogo vigente de D1; el cuerpo no acepta importes. Misma `Idempotency-Key` y mismo cuerpo → la misma respuesta, con el mismo `trackingToken`, sin volver a validar Turnstile; otro cuerpo → 409 `IDEMPOTENCY_CONFLICT`. Con la sesión de un miembro de la organización (de esa sucursal si es `staff`), el pedido es de prueba y se acepta aunque ningún dueño haya verificado su correo o la sucursal esté cerrada.",
      security: [{ InternalToken: [] }, { InternalToken: [], SessionCookie: [] }],
      parameters: [
        {
          name: IDEMPOTENCY_KEY_HEADER,
          in: "header",
          required: true,
          description: "UUID generado por WEB para este envío; se reutiliza en cada reintento.",
          schema: { type: "string", format: "uuid" },
        },
        {
          name: TURNSTILE_HEADER,
          in: "header",
          required: true,
          description:
            "Token de Turnstile de un solo uso. Un reintento con una llave ya registrada no lo valida.",
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(OrderInput) } },
      },
      responses: {
        201: jsonResponse(
          "Pedido registrado. `trackingToken` abre el seguimiento y solo se entrega en esta respuesta.",
          OrderCreatedDto,
        ),
        400: jsonResponse(
          "Datos inválidos (incluye llaves de más, como `price` o `total`), llave con formato inválido o Turnstile rechazado.",
          ErrorResponse,
        ),
        404: jsonResponse(
          "El menú no existe o no está publicado. Sin token interno, la respuesta no tiene cuerpo.",
          ErrorResponse,
        ),
        409: jsonResponse(
          "La llave ya se usó con otro cuerpo (`IDEMPOTENCY_CONFLICT`).",
          ErrorResponse,
        ),
        422: jsonResponse(
          "El negocio no recibe pedidos (cerrado, sin verificar, inactivo o suspendido), la modalidad está apagada, la mesa no existe, no hay zona para el código postal, algún producto cambió (errores por ítem en `fieldErrors`) o el total supera el tope de la sucursal (`BUSINESS_RULE`).",
          ErrorResponse,
        ),
        429: jsonResponse(
          "30 pedidos por hora desde esta IP, 3 en 10 minutos del mismo teléfono en la sucursal o demasiadas peticiones. Espera los segundos del header Retry-After.",
          ErrorResponse,
        ),
        500: jsonResponse("Ocurrió un error interno; no se registró el pedido.", ErrorResponse),
      },
    }),
    validator("json", OrderInput, rejectWith(OrderInput)),
    async (c) => {
      const key = parseIdempotencyKey(c.req.header(IDEMPOTENCY_KEY_HEADER));
      const result = await createOrder(
        {
          db: createDb(c.env),
          env: c.env,
          requestId: c.var.requestId,
          clientIp: c.var.clientIp,
          user: c.var.user,
          turnstileToken: c.req.header(TURNSTILE_HEADER),
        },
        key,
        c.req.valid("json"),
      );
      return c.json(result.body, result.statusCode);
    },
  )
  // Seguimiento (T22): el token no adivinable es la única credencial.
  .get(
    "/:token",
    describeRoute({
      tags: ["Pedidos"],
      summary: "Consultar el seguimiento de un pedido",
      description:
        "Busca por el SHA-256 del token. No expone datos del comensal: de un domicilio solo muestra la colonia. Responde `ETag` por versión del pedido; con `If-None-Match` vigente responde 304. Siempre `Cache-Control: no-store`.",
      security: [{ InternalToken: [] }],
      parameters: [
        {
          name: "token",
          in: "path",
          required: true,
          description: "Token de seguimiento que entregó la creación del pedido.",
          schema: { type: "string" },
        },
        {
          name: "If-None-Match",
          in: "header",
          required: false,
          description: "`ETag` de la última respuesta recibida.",
          schema: { type: "string" },
        },
      ],
      responses: {
        200: jsonResponse("Estado actual del pedido.", PublicOrderDto),
        304: { description: "El pedido no cambió desde el `ETag` enviado." },
        404: jsonResponse(
          "El token no corresponde a ningún pedido. Sin token interno, la respuesta no tiene cuerpo.",
          ErrorResponse,
        ),
        429: jsonResponse(
          "Demasiadas peticiones desde esta IP. Espera los segundos del header Retry-After.",
          ErrorResponse,
        ),
      },
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      const { etag, body } = await getTrackedOrder(
        createDb(c.env),
        c.req.param("token"),
        c.req.header("if-none-match"),
      );
      c.header("ETag", etag);
      return body ? c.json(body, 200) : c.body(null, 304);
    },
  );

function panelDeps(c: Context<TenantEnv>): OrderPanelDeps {
  return { db: createDb(c.env), tenant: c.var.tenant, requestId: c.var.requestId };
}

function branchId(c: Context<TenantEnv>) {
  return routeParam(BranchParams, "branchId", c.req.param("branchId"));
}

function orderId(c: Context<TenantEnv>) {
  return routeParam(OrderParams, "orderId", c.req.param("orderId"));
}

const orderIdParameter = {
  name: "orderId",
  in: "path",
  required: true,
  description: "Id (UUIDv7) del pedido.",
  schema: { type: "string", format: "uuid" },
} as const;

const orderNotFound = jsonResponse(
  "La organización, la sucursal o el pedido no existen, o la sucursal no está asignada a tu cuenta.",
  ErrorResponse,
);

// Se monta en `orgScoped` (`/v1/orgs/:orgId/branches/:branchId/orders`), que ya aplicó
// `requireAuth`, `requireMembership()` y `requireOperable()`.
export const orderPanelRoutes = new Hono<TenantEnv>()
  .get(
    "/",
    describeRoute({
      tags: ["Pedidos"],
      summary: "Listar los pedidos de la sucursal",
      description:
        "`status` elige en curso (`active`, por defecto) o terminados (`done`). Con `since` (ms) se ignora `status` y vuelven todos los pedidos cambiados desde entonces, también los que ya terminaron. Para el siguiente sondeo usa `nextSince` de la primera página. Responde `ETag`; con `If-None-Match` vigente responde 304. No incluye teléfono ni dirección.",
      security: privateSecurity,
      parameters: [
        orgIdParameter,
        branchIdParameter,
        {
          name: "If-None-Match",
          in: "header",
          required: false,
          description: "`ETag` de la última respuesta recibida.",
          schema: { type: "string" },
        },
      ],
      responses: {
        200: jsonResponse("Página de pedidos.", OrderListDto),
        304: { description: "El tablero no cambió desde el `ETag` enviado." },
        400: invalidInput,
        403: forbidden,
        ...orgScopedResponses,
        404: orderNotFound,
      },
    }),
    requirePermission("orders:read"),
    requireBranch(),
    validator("query", OrderListQuery, rejectWith(OrderListQuery)),
    async (c) => {
      c.header("Cache-Control", "no-store");
      const { etag, body } = await listOrders(
        panelDeps(c),
        branchId(c),
        c.req.valid("query"),
        c.req.header("if-none-match"),
      );
      if (etag) c.header("ETag", etag);
      return body ? c.json(body, 200) : c.body(null, 304);
    },
  )
  .get(
    "/:orderId",
    describeRoute({
      tags: ["Pedidos"],
      summary: "Consultar el detalle de un pedido",
      description: "Incluye teléfono, dirección completa e historial con actor y motivo.",
      security: privateSecurity,
      parameters: [orgIdParameter, branchIdParameter, orderIdParameter],
      responses: {
        200: jsonResponse("Pedido completo.", OrderDetailDto),
        403: forbidden,
        ...orgScopedResponses,
        404: orderNotFound,
      },
    }),
    requirePermission("orders:read"),
    requireBranch(),
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await getOrder(panelDeps(c), branchId(c), orderId(c)));
    },
  )
  .post(
    "/:orderId/transitions",
    describeRoute({
      tags: ["Pedidos"],
      summary: "Cambiar el estado de un pedido",
      description:
        "Avanza un estado a la vez, con la `version` leída. `reason` es obligatorio para `rejected` y `cancelled` y no aplica en otro caso. Solo dueños y administradores pueden cancelar.",
      security: privateSecurity,
      parameters: [orgIdParameter, branchIdParameter, orderIdParameter],
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(OrderTransitionInput) } },
      },
      responses: {
        200: jsonResponse("Pedido con su nuevo estado.", OrderDetailDto),
        400: invalidInput,
        403: forbidden,
        ...orgScopedResponses,
        404: orderNotFound,
        409: jsonResponse(
          "Otra persona ya actualizó el pedido (`version` vieja). Vuelve a leerlo.",
          ErrorResponse,
        ),
        422: jsonResponse(
          "El estado actual o la modalidad no permiten este cambio (`INVALID_TRANSITION`).",
          ErrorResponse,
        ),
      },
    }),
    requirePermission("orders:transition"),
    requireBranch(),
    validator("json", OrderTransitionInput, rejectWith(OrderTransitionInput)),
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(
        await transitionOrder(panelDeps(c), branchId(c), orderId(c), c.req.valid("json")),
      );
    },
  );
