import {
  ChangePasswordDto,
  ChangePasswordInput,
  ErrorResponse,
  GetSessionDto,
  GetSessionQuery,
  LINK_SENT_MESSAGE,
  LinkSentDto,
  MeDto,
  RequestPasswordResetInput,
  ResetPasswordDto,
  ResetPasswordInput,
  ResetPasswordQuery,
  SendVerificationEmailInput,
  SignInDto,
  SignInInput,
  SignOutDto,
  SignOutInput,
  VerifyEmailDto,
  VerifyEmailQuery,
} from "@menu-max/contracts";
import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import { describeRoute, resolver, validator } from "hono-openapi";
import type { ZodType } from "zod";
import { TURNSTILE_HEADER } from "../../infrastructure/turnstile";
import { requireAuth } from "../../middleware/require-auth";
import { session } from "../../middleware/session";
import { AppError } from "../../shared/errors";
import type { AppEnv } from "../../types";
import {
  changePassword,
  forwardAuth,
  requestPasswordReset,
  resendVerification,
  signIn,
  getMe,
  verifyEmail,
  type AuthDeps,
} from "./auth.service";

function jsonResponse(description: string, schema: ZodType) {
  return { description, content: { "application/json": { schema: resolver(schema) } } };
}

const tooManyRequests = jsonResponse(
  "Demasiadas peticiones desde esta IP. Espera los segundos del header Retry-After.",
  ErrorResponse,
);

function describeAuthRoute(
  summary: string,
  responses: NonNullable<Parameters<typeof describeRoute>[0]["responses"]>,
  input?: ZodType,
  parameters?: Parameters<typeof describeRoute>[0]["parameters"],
) {
  return describeRoute({
    summary,
    tags: ["Autenticación"],
    security: [{ InternalToken: [] }],
    ...(parameters && { parameters }),
    ...(input && {
      requestBody: {
        required: !input.isOptional(),
        content: { "application/json": { schema: resolver(input) } },
      },
    }),
    responses: {
      400: jsonResponse("Datos inválidos.", ErrorResponse),
      403: jsonResponse("Origen o destino de redirección rechazado.", ErrorResponse),
      404: { description: "El token interno falta o es inválido. La respuesta no tiene cuerpo." },
      429: tooManyRequests,
      500: jsonResponse("Ocurrió un error interno.", ErrorResponse),
      ...responses,
    },
  });
}

function rejectInvalid(result: { success: boolean }) {
  if (!result.success) throw new AppError("VALIDATION_FAILED");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_FAILED");
  }
}

type Send<T> = (c: Context<AppEnv>, request: Request, data: T) => Promise<Response>;

function forwardJson<T>(
  schema: ZodType<T>,
  prepare: (data: T) => T = (data) => data,
  send: Send<T> = (c, request) => forwardAuth(c.env, request),
) {
  return createMiddleware<AppEnv>(async (c) => {
    const request = c.req.raw;
    const text = await c.req.text();
    const headers = new Headers(request.headers);
    if (text && !/^application\/json(?:\s*;|$)/i.test(headers.get("content-type") ?? "")) {
      throw new AppError("VALIDATION_FAILED", "Envía los datos en formato JSON.");
    }
    const data = schema.parse(text ? parseJson(text) : undefined);
    headers.delete("content-length");
    if (data === undefined) headers.delete("content-type");
    return send(
      c,
      new Request(request.url, {
        method: "POST",
        headers,
        body: data === undefined ? undefined : JSON.stringify(prepare(data)),
      }),
      data,
    );
  });
}

function deps(c: Context<AppEnv>): AuthDeps {
  return {
    env: c.env,
    requestId: c.var.requestId,
    clientIp: c.var.clientIp,
    waitUntil: (promise) => c.executionCtx.waitUntil(promise),
  };
}

const linkSent: LinkSentDto = { message: LINK_SENT_MESSAGE };
const forward = createMiddleware<AppEnv>((c) => forwardAuth(c.env, c.req.raw));
const sessionRequired = jsonResponse("La sesión falta o ya no es válida.", ErrorResponse);
const linkAccepted = jsonResponse(
  "Solicitud recibida. La respuesta es la misma exista o no el correo.",
  LinkSentDto,
);

export const authRoutes = new Hono<AppEnv>()
  .post(
    "/sign-in/email",
    describeAuthRoute(
      "Iniciar sesión con correo",
      {
        200: jsonResponse("Sesión iniciada y cookie configurada.", SignInDto),
        401: jsonResponse("Correo o contraseña incorrectos.", ErrorResponse),
        429: jsonResponse(
          "Cinco intentos fallidos con este correo desde esta IP en 15 minutos, o demasiadas peticiones. Espera los segundos del header Retry-After.",
          ErrorResponse,
        ),
      },
      SignInInput,
    ),
    forwardJson(SignInInput, undefined, (c, request, data) =>
      signIn(
        { env: c.env, requestId: c.var.requestId, clientIp: c.var.clientIp },
        request,
        data.email,
      ),
    ),
  )
  .post(
    "/sign-out",
    describeAuthRoute(
      "Cerrar sesión",
      {
        200: jsonResponse("Sesión cerrada y cookie eliminada.", SignOutDto),
      },
      SignOutInput,
    ),
    forwardJson(SignOutInput),
  )
  .get(
    "/get-session",
    describeAuthRoute("Obtener la sesión actual", {
      200: jsonResponse("Sesión actual o null si falta o ya no es válida.", GetSessionDto),
    }),
    validator("query", GetSessionQuery, rejectInvalid),
    forward,
  )
  .get(
    "/verify-email",
    describeAuthRoute("Verificar el correo", {
      200: jsonResponse("Correo verificado y sesión iniciada con su cookie.", VerifyEmailDto),
      400: jsonResponse("El enlace no es válido o ya venció.", ErrorResponse),
      409: jsonResponse("El enlace ya se usó.", ErrorResponse),
    }),
    validator("query", VerifyEmailQuery, rejectInvalid),
    (c) => verifyEmail(deps(c), c.req.raw),
  )
  .post(
    "/send-verification-email",
    describeAuthRoute(
      "Solicitar otro correo de verificación",
      {
        202: linkAccepted,
        401: sessionRequired,
        429: jsonResponse(
          "Se excedió la cuota de 1 cada 60 s o 5 por día (UTC). Espera los segundos del header Retry-After.",
          ErrorResponse,
        ),
      },
      SendVerificationEmailInput,
    ),
    session,
    requireAuth,
    forwardJson(SendVerificationEmailInput, undefined, async (c, request) => {
      // `requireAuth` garantiza la sesión; el correo sale de ella, no del cliente.
      const userId = c.var.user?.id;
      if (!userId) throw new AppError("AUTH_REQUIRED");
      await resendVerification(deps(c), request, userId);
      return c.json(linkSent, 202);
    }),
  )
  .post(
    "/request-password-reset",
    describeAuthRoute(
      "Solicitar el restablecimiento de contraseña",
      {
        202: linkAccepted,
        400: jsonResponse(
          "Datos inválidos o verificación de Turnstile fallida o reutilizada.",
          ErrorResponse,
        ),
        429: jsonResponse(
          "Se excedió la cuota de 3 por hora para este correo, exista o no. Espera los segundos del header Retry-After.",
          ErrorResponse,
        ),
      },
      RequestPasswordResetInput,
      [
        {
          name: TURNSTILE_HEADER,
          in: "header",
          required: true,
          description: "Token de Turnstile de un solo uso.",
          schema: { type: "string" },
        },
      ],
    ),
    forwardJson(RequestPasswordResetInput, undefined, async (c, request, data) => {
      await requestPasswordReset(deps(c), request, data.email);
      return c.json(linkSent, 202);
    }),
  )
  .post(
    "/reset-password",
    describeAuthRoute(
      "Restablecer la contraseña",
      {
        200: jsonResponse("Contraseña restablecida y sesiones revocadas.", ResetPasswordDto),
      },
      ResetPasswordInput,
    ),
    validator("query", ResetPasswordQuery, rejectInvalid),
    forwardJson(ResetPasswordInput, undefined, (c, request) =>
      forwardAuth(c.env, request, deps(c)),
    ),
  )
  .post(
    "/change-password",
    describeAuthRoute(
      "Cambiar la contraseña",
      {
        200: jsonResponse("Contraseña cambiada y demás sesiones revocadas.", ChangePasswordDto),
        401: sessionRequired,
      },
      ChangePasswordInput,
    ),
    forwardJson(
      ChangePasswordInput,
      (data) => ({ ...data, revokeOtherSessions: true }),
      (c, request) => changePassword(deps(c), request),
    ),
  );

export const meRoutes = new Hono<AppEnv>().get(
  "/me",
  describeRoute({
    tags: ["Autenticación"],
    summary: "Consultar mi usuario y mis organizaciones",
    security: [{ InternalToken: [], SessionCookie: [] }],
    responses: {
      200: jsonResponse("Usuario de la sesión y sus membresías activas.", MeDto),
      401: sessionRequired,
      404: { description: "El token interno falta o es inválido. La respuesta no tiene cuerpo." },
      429: tooManyRequests,
      500: jsonResponse("Ocurrió un error interno.", ErrorResponse),
    },
  }),
  requireAuth,
  async (c) => c.json(await getMe(c.env, c.var.user)),
);
