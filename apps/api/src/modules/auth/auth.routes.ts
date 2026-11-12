import {
  ChangePasswordDto,
  ChangePasswordInput,
  ErrorResponse,
  GetSessionDto,
  GetSessionQuery,
  MeDto,
  PasswordResetLinkParams,
  PasswordResetLinkQuery,
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
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describeRoute, resolver, validator } from "hono-openapi";
import type { ZodType } from "zod";
import { requireAuth } from "../../middleware/require-auth";
import { AppError } from "../../shared/errors";
import type { AppEnv } from "../../types";
import { forwardAuth, toMeDto } from "./auth.service";

function jsonResponse(description: string, schema: ZodType) {
  return { description, content: { "application/json": { schema: resolver(schema) } } };
}

function describeAuthRoute(
  summary: string,
  responses: NonNullable<Parameters<typeof describeRoute>[0]["responses"]>,
  input?: ZodType,
) {
  return describeRoute({
    summary,
    tags: ["Autenticación"],
    security: [{ InternalToken: [] }],
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

function forwardJson<T>(schema: ZodType<T>, prepare: (data: T) => T = (data) => data) {
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
    return forwardAuth(
      c.env,
      new Request(request.url, {
        method: "POST",
        headers,
        body: data === undefined ? undefined : JSON.stringify(prepare(data)),
      }),
    );
  });
}

const forward = createMiddleware<AppEnv>((c) => forwardAuth(c.env, c.req.raw));
const noEmail = jsonResponse("El envío de correos aún no está disponible.", ErrorResponse);
const sessionRequired = jsonResponse("La sesión falta o ya no es válida.", ErrorResponse);
const redirected = { description: "Redirección al origen de WEB." };

export const authRoutes = new Hono<AppEnv>()
  .post(
    "/sign-in/email",
    describeAuthRoute(
      "Iniciar sesión con correo",
      {
        200: jsonResponse("Sesión iniciada y cookie configurada.", SignInDto),
        401: jsonResponse("Correo o contraseña incorrectos.", ErrorResponse),
      },
      SignInInput,
    ),
    forwardJson(SignInInput),
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
      200: jsonResponse("Correo verificado.", VerifyEmailDto),
      302: redirected,
    }),
    validator("query", VerifyEmailQuery, rejectInvalid),
    forward,
  )
  .post(
    "/send-verification-email",
    describeAuthRoute(
      "Solicitar otro correo de verificación",
      { 422: noEmail },
      SendVerificationEmailInput,
    ),
    forwardJson(SendVerificationEmailInput),
  )
  .post(
    "/request-password-reset",
    describeAuthRoute(
      "Solicitar el restablecimiento de contraseña",
      { 422: noEmail },
      RequestPasswordResetInput,
    ),
    forwardJson(RequestPasswordResetInput),
  )
  .get(
    "/reset-password/:token",
    describeAuthRoute("Abrir el enlace de restablecimiento", { 302: redirected }),
    validator("param", PasswordResetLinkParams, rejectInvalid),
    validator("query", PasswordResetLinkQuery, rejectInvalid),
    forward,
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
    forwardJson(ResetPasswordInput),
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
    forwardJson(ChangePasswordInput, (data) => ({ ...data, revokeOtherSessions: true })),
  );

export const meRoutes = new Hono<AppEnv>().get(
  "/me",
  describeRoute({
    tags: ["Autenticación"],
    summary: "Consultar mi usuario",
    security: [{ InternalToken: [], SessionCookie: [] }],
    responses: {
      200: jsonResponse("Usuario de la sesión.", MeDto),
      401: sessionRequired,
      404: { description: "El token interno falta o es inválido. La respuesta no tiene cuerpo." },
      500: jsonResponse("Ocurrió un error interno.", ErrorResponse),
    },
  }),
  requireAuth,
  (c) => c.json(toMeDto(c.var.user)),
);
