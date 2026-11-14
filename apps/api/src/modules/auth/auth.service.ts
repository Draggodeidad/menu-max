import type { MeDto } from "@menu-max/contracts";
import { isAPIError } from "better-auth/api";
import type { SQL } from "drizzle-orm";
import type { Env } from "../../env";
import { createDb, type Db } from "../../infrastructure/db";
import { AppError } from "../../shared/errors";
import { log } from "../../shared/log";
import { verifyTurnstile, TURNSTILE_HEADER } from "../../infrastructure/turnstile";
import { normalizeEmail } from "../../shared/email-checks";
import { hit, peek } from "../../shared/rate-counters";
import { listMemberships } from "../organizations/organizations.service";
import { createAuth, sendAuthEmail, type AuthRequestOptions, type AuthUser } from "./auth";
import { findEmailState, findUserIdByEmail, markEmailVerified } from "./auth.repository";
import { resetPasswordLink } from "./web-links";

export type AuthDeps = {
  env: Env;
  requestId: string;
  clientIp: string | undefined;
  waitUntil: (promise: Promise<unknown>) => void;
};

export function readSession(env: Env, headers: Headers) {
  return createAuth(env).api.getSession({ headers, returnHeaders: true });
}

/** Usuario de la sesión y sus membresías activas (ADR-006). */
export async function getMe(env: Env, user: AuthUser): Promise<MeDto> {
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
    },
    memberships: await listMemberships(createDb(env), user.id),
  };
}

export async function forwardAuth(
  env: Env,
  request: Request,
  options: AuthRequestOptions = {},
): Promise<Response> {
  const origin = request.headers.get("origin");
  if (request.method === "POST" && origin !== null && origin !== env.WEB_ORIGIN) {
    throw new AppError("FORBIDDEN", "La solicitud debe venir de MenusMax.");
  }

  const response = await createAuth(env, options).handler(request);
  if (response.status < 400) return response;
  if (response.status >= 500) throw new Error("Falló el proveedor de autenticación.");

  const payload = await response.json<{ code?: string }>().catch(() => null);
  switch (payload?.code) {
    case "PASSWORD_COMPROMISED":
      throw new AppError("VALIDATION_FAILED", "Esta contraseña se ha filtrado. Elige otra.");
    case "INVALID_EMAIL_OR_PASSWORD":
      throw new AppError("AUTH_REQUIRED", "El correo o la contraseña son incorrectos.");
    case "INVALID_PASSWORD":
      throw new AppError("VALIDATION_FAILED", "La contraseña actual es incorrecta.");
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
    case "USER_NOT_FOUND":
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

/** `rate_counters` no guarda el correo en claro: solo el SHA-256 del correo normalizado. */
async function emailDigest(email: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(email.trim().toLowerCase()),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loginFailureKey(email: string, clientIp: string | undefined) {
  return `login-fail:${await emailDigest(email)}:${clientIp ?? "unknown"}`;
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

/** Misma petición a Better Auth con otro cuerpo JSON (lo arma el servidor, no el cliente). */
function withJsonBody(request: Request, body: object) {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  return new Request(request.url, { method: "POST", headers, body: JSON.stringify(body) });
}

/** Cuenta la llamada; excedida → `RATE_LIMITED` con `Retry-After` hasta que cierra la ventana. */
async function consumeQuota(
  deps: AuthDeps,
  key: string,
  windowMs: number,
  limit: number,
  message: string,
) {
  const quota = await hit(createDb(deps.env), key, windowMs, limit);
  if (quota.allowed) return;
  log.warn("auth.quota_exceeded", { requestId: deps.requestId, quota: key.split(":", 1)[0] });
  throw new AppError("RATE_LIMITED", message, undefined, quota.retryAfterMs / 1000);
}

/**
 * Canjea el enlace de verificación. El token de Better Auth es un JWT sin estado: si esta
 * petición no marcó el correo como verificado, el enlace ya se había usado → `CONFLICT`.
 */
export async function verifyEmail(deps: AuthDeps, request: Request): Promise<Response> {
  let verified = false;
  const response = await forwardAuth(deps.env, request, {
    requestId: deps.requestId,
    onEmailVerified: () => {
      verified = true;
    },
  });
  if (!verified) {
    await response.body?.cancel();
    throw new AppError(
      "CONFLICT",
      "Este enlace ya se usó. Si ya confirmaste tu correo, solo entra.",
    );
  }
  return response;
}

// Reenvío de verificación (ADR-008, ADR-010): 1 cada 60 s y 5 por día por usuario.
// Las ventanas son fijas en UTC: "por día" se reinicia a las 00:00 UTC.
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const RESEND_TOO_SOON =
  "Ya te enviamos un enlace. Revisa tu bandeja y la carpeta de spam, o espera un minuto para pedir otro.";
const RESEND_DAILY_LIMIT =
  "Ya pediste cinco enlaces hoy. Revisa tu bandeja y la carpeta de spam, o inténtalo mañana.";

/**
 * Reenvía el correo de verificación al correo de la sesión. Si ya está verificado o no es
 * entregable, no encola ni gasta cuota; la respuesta es la misma en todos los casos.
 */
export async function resendVerification(
  deps: AuthDeps,
  request: Request,
  userId: string,
): Promise<void> {
  const state = await findEmailState(createDb(deps.env), userId);
  if (!state || state.emailVerified || state.emailStatus === "undeliverable") return;

  await consumeQuota(deps, `verify-resend-min:${userId}`, MINUTE_MS, 1, RESEND_TOO_SOON);
  await consumeQuota(deps, `verify-resend-day:${userId}`, DAY_MS, 5, RESEND_DAILY_LIMIT);
  await forwardAuth(deps.env, withJsonBody(request, { email: state.email }), {
    requestId: deps.requestId,
    waitUntil: deps.waitUntil,
  });
}

// Solicitar reset (ADR-010): 3 por hora por correo normalizado, exista o no la cuenta.
const RESET_LIMIT =
  "Ya pediste varios enlaces para este correo. Revisa tu bandeja o espera una hora para pedir otro.";

/**
 * Turnstile → cuota → Better Auth. Better Auth responde igual si el correo no existe; el correo
 * se encola con `waitUntil` para que una cuenta existente no tarde más en responder.
 */
export async function requestPasswordReset(
  deps: AuthDeps,
  request: Request,
  rawEmail: string,
): Promise<void> {
  await verifyTurnstile(deps.env, request.headers.get(TURNSTILE_HEADER), deps.clientIp);
  const email = normalizeEmail(rawEmail);
  await consumeQuota(deps, `reset:${await emailDigest(email)}`, HOUR_MS, 3, RESET_LIMIT);
  await forwardAuth(deps.env, withJsonBody(request, { email }), {
    requestId: deps.requestId,
    waitUntil: deps.waitUntil,
  });
}

/** Cambia la contraseña y avisa por correo (`password-changed`) después de responder. */
export async function changePassword(deps: AuthDeps, request: Request): Promise<Response> {
  const response = await forwardAuth(deps.env, request, { requestId: deps.requestId });
  const body = await response
    .clone()
    .json<{ user?: { email?: unknown } }>()
    .catch(() => null);
  const email = body?.user?.email;
  if (typeof email === "string") {
    await sendAuthEmail(
      deps.env,
      { requestId: deps.requestId, waitUntil: deps.waitUntil },
      { to: email, template: "password-changed", url: resetPasswordLink(deps.env) },
    );
  } else {
    log.error("auth.password_changed_without_user", { requestId: deps.requestId });
  }
  return response;
}

/** `true` si ya existe una cuenta con ese correo normalizado. */
export async function accountExists(db: Db, email: string): Promise<boolean> {
  return (await findUserIdByEmail(db, email)) !== undefined;
}

/**
 * Sentencia para el `db.batch` de otro módulo: marca verificado el correo del usuario solo si se
 * cumple `when` (p. ej., que la invitación se haya canjeado en el mismo batch).
 */
export function emailVerifiedStatement(db: Db, userId: string, when: SQL) {
  return markEmailVerified(db, userId, when);
}

export const ACCOUNT_EXISTS_MESSAGE = "Entra con tu cuenta para aceptar la invitación.";

type InvitedUser = { email: string; name: string; password: string };

/**
 * Crea la cuenta de quien acepta una invitación sin tener una (T13) y abre su sesión. No envía
 * `verify-email`: el enlace de invitación ya probó el correo. Devuelve las cookies de sesión.
 */
export async function createInvitedUser(
  deps: { env: Env; requestId: string },
  requestHeaders: Headers,
  input: InvitedUser,
): Promise<{ userId: string; setCookies: string[] }> {
  // Solo los headers que Better Auth usa para la sesión; nunca cookies del cliente.
  const headers = new Headers();
  for (const name of ["x-client-ip", "user-agent"]) {
    const value = requestHeaders.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const { headers: responseHeaders, response } = await createAuth(deps.env, {
      requestId: deps.requestId,
      skipVerificationEmail: true,
    }).api.signUpEmail({ body: input, headers, returnHeaders: true });
    return { userId: response.user.id, setCookies: responseHeaders.getSetCookie() };
  } catch (error) {
    if (!isAPIError(error)) throw error;
    const code = (error.body as { code?: unknown } | undefined)?.code;
    if (code === "PASSWORD_COMPROMISED") {
      const message = "Esta contraseña se ha filtrado. Elige otra.";
      throw new AppError("VALIDATION_FAILED", message, { password: [message] });
    }
    // Carrera: otra petición creó la cuenta con este correo entre la consulta y el registro.
    if (code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
      throw new AppError("AUTH_REQUIRED", ACCOUNT_EXISTS_MESSAGE);
    }
    if (error.statusCode < 500) throw new AppError("VALIDATION_FAILED");
    throw error;
  }
}
