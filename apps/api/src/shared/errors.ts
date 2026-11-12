import { ERROR_HTTP_STATUS, type ErrorCode, type ErrorResponse } from "@menu-max/contracts";
import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import { log } from "./log";

const messages = {
  VALIDATION_FAILED: "Hay datos inválidos. Revisa los campos e inténtalo de nuevo.",
  AUTH_REQUIRED: "Inicia sesión para continuar.",
  EMAIL_NOT_VERIFIED: "Verifica tu correo para continuar.",
  FORBIDDEN: "Tu cuenta no tiene permiso para realizar esta acción.",
  NOT_FOUND: "No encontramos lo que buscabas. Revisa el enlace.",
  CONFLICT: "Hay un conflicto con los datos actuales. Actualiza la página e inténtalo de nuevo.",
  IDEMPOTENCY_CONFLICT: "Ya se usó esta clave con otros datos. Usa una clave nueva.",
  PAYLOAD_TOO_LARGE: "La solicitud supera 64 KB. Reduce su tamaño e inténtalo de nuevo.",
  INVALID_TRANSITION: "El estado actual no permite este cambio. Actualiza la página.",
  BUSINESS_RULE: "No se pudo completar la acción. Revisa los datos e inténtalo de nuevo.",
  PLAN_LIMIT_REACHED: "Alcanzaste el límite de tu plan. Revisa tu suscripción.",
  RATE_LIMITED: "Hiciste demasiados intentos. Espera un momento y vuelve a intentarlo.",
  INTERNAL: "Ocurrió un problema. Inténtalo de nuevo en unos momentos.",
} satisfies Record<ErrorCode, string>;

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message = messages[code],
    readonly fieldErrors?: ErrorResponse["fieldErrors"],
  ) {
    super(message);
    this.name = "AppError";
  }
}

function respond(c: Context<AppEnv>, error: AppError) {
  const response: ErrorResponse = {
    code: error.code,
    message: error.message,
    requestId: c.var.requestId,
    fieldErrors: error.fieldErrors,
  };
  return c.json(response, ERROR_HTTP_STATUS[error.code]);
}

export const onError: ErrorHandler<AppEnv> = (error, c) => {
  if (error instanceof AppError) return respond(c, error);

  if (error instanceof z.ZodError) {
    // Los mensajes de Zod pueden incluir valores enviados o nombres de llaves desconocidas.
    const { fieldErrors, formErrors } = z.flattenError(error, () => "Revisa este valor.");
    return respond(
      c,
      new AppError("VALIDATION_FAILED", undefined, {
        ...fieldErrors,
        ...(formErrors.length > 0 ? { "": formErrors } : {}),
      }),
    );
  }

  // La primera línea y sus continuaciones pueden contener SQL, credenciales o datos personales.
  const errorDescription = `${error.name}: ${error.message}`;
  const stack = error.stack
    ?.split("\n")
    .slice(errorDescription.split("\n").length)
    .filter((line) => line.trimStart().startsWith("at "))
    .join("\n");
  log.error("http.unexpected_error", { requestId: c.var.requestId, stack });
  return respond(c, new AppError("INTERNAL"));
};

export const notFound: NotFoundHandler<AppEnv> = (c) => respond(c, new AppError("NOT_FOUND"));
