import {
  ErrorResponse,
  IDEMPOTENCY_KEY_HEADER,
  OnboardingDto,
  OnboardingInput,
} from "@menu-max/contracts";
import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import { createDb } from "../../infrastructure/db";
import { TURNSTILE_HEADER } from "../../infrastructure/turnstile";
import { parseIdempotencyKey } from "../../shared/idempotency";
import type { AppEnv } from "../../types";
import { jsonResponse, rejectWith } from "../organizations/organizations.routes";
import { onboard } from "./onboarding.service";

/** `POST /v1/onboarding` (T20): ruta sin tenant; la protegen Turnstile, la cuota por IP y la llave. */
export const onboardingRoutes = new Hono<AppEnv>().post(
  "/",
  describeRoute({
    tags: ["Onboarding"],
    summary: "Crear cuenta y publicar el menú en un solo envío",
    description:
      "Crea la cuenta (sin sesión), la organización con prueba `pro` de 90 días, el negocio, la sucursal y el menú publicado con sus productos. Misma `Idempotency-Key` y mismo cuerpo → la misma respuesta; otro cuerpo → 409 `IDEMPOTENCY_CONFLICT`. Si el alta falla después de crear la cuenta, la respuesta de error abre la sesión y el reintento con la misma llave y la sesión la completa.",
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
        description: "Token de Turnstile de un solo uso.",
        schema: { type: "string" },
      },
    ],
    requestBody: {
      required: true,
      content: { "application/json": { schema: resolver(OnboardingInput) } },
    },
    responses: {
      201: jsonResponse(
        "Alta completa. Sin sesión previa, incluye la cookie de sesión (Set-Cookie).",
        OnboardingDto,
      ),
      400: jsonResponse(
        "Datos inválidos, correo desechable o sin MX, contraseña filtrada, más productos de los que admite el alta o Turnstile rechazado.",
        ErrorResponse,
      ),
      404: { description: "El token interno falta o es inválido. La respuesta no tiene cuerpo." },
      409: jsonResponse(
        "El correo ya tiene cuenta, la sesión es de otra cuenta o ya tiene negocio (`CONFLICT`), o la llave se usó con otro cuerpo (`IDEMPOTENCY_CONFLICT`).",
        ErrorResponse,
      ),
      429: jsonResponse(
        "Tres altas desde esta IP hoy (UTC) o demasiadas peticiones. Espera los segundos del header Retry-After.",
        ErrorResponse,
      ),
      500: jsonResponse(
        "Ocurrió un error interno. Si ya se creó la cuenta, incluye la cookie de sesión.",
        ErrorResponse,
      ),
    },
  }),
  validator("json", OnboardingInput, rejectWith(OnboardingInput)),
  async (c) => {
    const key = parseIdempotencyKey(c.req.header(IDEMPOTENCY_KEY_HEADER));
    const result = await onboard(
      {
        db: createDb(c.env),
        env: c.env,
        requestId: c.var.requestId,
        clientIp: c.var.clientIp,
        user: c.var.user,
        headers: c.req.raw.headers,
        waitUntil: (promise) => c.executionCtx.waitUntil(promise),
        // Antes del batch: si falla, `onError` responde con estas cookies ya puestas.
        onSession: (setCookies) => {
          for (const cookie of setCookies) c.header("Set-Cookie", cookie, { append: true });
        },
      },
      key,
      c.req.valid("json"),
    );
    return c.json(result.body, result.statusCode as 201);
  },
);
