import type { MeDto } from "@menu-max/contracts";
import type { Env } from "../../env";
import { AppError } from "../../shared/errors";
import { createAuth, type AuthUser } from "./auth";

export function readSession(env: Env, headers: Headers) {
  return createAuth(env).api.getSession({ headers, returnHeaders: true });
}

export function toMeDto(user: AuthUser): MeDto {
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
    },
  };
}

export async function forwardAuth(env: Env, request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (request.method === "POST" && origin !== null && origin !== env.WEB_ORIGIN) {
    throw new AppError("FORBIDDEN", "La solicitud debe venir de MenusMax.");
  }

  const response = await createAuth(env).handler(request);
  if (response.status < 400) return response;
  if (response.status >= 500) throw new Error("Falló el proveedor de autenticación.");

  const payload = await response.json<{ code?: string }>().catch(() => null);
  switch (payload?.code) {
    case "RESET_PASSWORD_DISABLED":
    case "VERIFICATION_EMAIL_NOT_ENABLED":
      throw new AppError(
        "BUSINESS_RULE",
        "El envío de correos aún no está disponible. Inténtalo más adelante.",
      );
    case "PASSWORD_COMPROMISED":
      throw new AppError("VALIDATION_FAILED", "Esta contraseña se ha filtrado. Elige otra.");
    case "INVALID_EMAIL_OR_PASSWORD":
      throw new AppError("AUTH_REQUIRED", "El correo o la contraseña son incorrectos.");
    case "INVALID_PASSWORD":
      throw new AppError("VALIDATION_FAILED", "La contraseña actual es incorrecta.");
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
      throw new AppError("VALIDATION_FAILED", "El enlace no es válido o ya venció. Solicita otro.");
  }

  switch (response.status) {
    case 401:
      throw new AppError("AUTH_REQUIRED");
    case 403:
      throw new AppError("FORBIDDEN", "La solicitud debe venir de MenusMax.");
    case 404:
      throw new AppError("NOT_FOUND");
    default:
      throw new AppError("VALIDATION_FAILED");
  }
}
