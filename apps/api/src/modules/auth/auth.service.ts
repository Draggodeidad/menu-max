import type { MeDto } from "@menu-max/contracts";
import type { Env } from "../../env";
import { createDb } from "../../infrastructure/db";
import { AppError } from "../../shared/errors";
import { log } from "../../shared/log";
import { hit, peek } from "../../shared/rate-counters";
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

// Bloqueo de login (ADR-010): 5 fallos en 15 min por correo + IP. Turnstile tras 3 fallos
// sigue Propuesto y no se implementa.
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

async function loginFailureKey(email: string, clientIp: string | undefined) {
  // `rate_counters` no guarda el correo en claro: solo su SHA-256.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(email.trim().toLowerCase()),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"));
  return `login-fail:${hash.join("")}:${clientIp ?? "unknown"}`;
}

type SignInDeps = { env: Env; requestId: string; clientIp: string | undefined };

/**
 * Inicia sesión con el bloqueo de fallos. Antes de reenviar solo se consulta la cuota; solo un
 * rechazo de credenciales la incrementa. Con 5 fallos en la ventana se responde `RATE_LIMITED`
 * aunque la contraseña sea correcta. Un login exitoso no reinicia el contador.
 */
export async function signIn(deps: SignInDeps, request: Request, email: string) {
  const db = createDb(deps.env);
  const key = await loginFailureKey(email, deps.clientIp);

  const quota = await peek(db, key, LOGIN_FAILURE_WINDOW_MS, LOGIN_MAX_FAILURES);
  if (!quota.allowed) {
    log.warn("auth.login_locked", { requestId: deps.requestId });
    throw new AppError(
      "RATE_LIMITED",
      "Hiciste demasiados intentos para entrar. Espera unos minutos o restablece tu contraseña.",
      undefined,
      quota.retryAfterMs / 1000,
    );
  }

  try {
    return await forwardAuth(deps.env, request);
  } catch (error) {
    // En inicio de sesión, `AUTH_REQUIRED` solo sale de credenciales incorrectas.
    if (error instanceof AppError && error.code === "AUTH_REQUIRED") {
      await hit(db, key, LOGIN_FAILURE_WINDOW_MS, LOGIN_MAX_FAILURES);
      log.warn("auth.login_failed", { requestId: deps.requestId });
    }
    throw error;
  }
}
