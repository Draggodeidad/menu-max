import type { Env } from "../env";
import { AppError } from "../shared/errors";

/** Convención del proyecto: el token viaja en este header, nunca en el body. */
export const TURNSTILE_HEADER = "x-turnstile-token";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 10_000;
// Cloudflare documenta tokens de hasta 2048 caracteres.
const MAX_TOKEN_LENGTH = 2048;
// Errores de configuración nuestra: no son culpa de quien llena el formulario.
const CONFIG_ERRORS = new Set(["missing-input-secret", "invalid-input-secret"]);

function rejected() {
  return new AppError(
    "VALIDATION_FAILED",
    "No pudimos confirmar que eres una persona. Completa la verificación e inténtalo de nuevo.",
    { turnstileToken: ["Completa la verificación de seguridad de nuevo."] },
  );
}

/**
 * Valida un token de Turnstile con `siteverify` (ADR-010). Los tokens son de un solo uso:
 * uno reutilizado llega como `timeout-or-duplicate` y se rechaza igual que uno inválido.
 * Si Cloudflare no responde o el secreto está mal configurado, lanza un error interno:
 * nunca se deja pasar una petición sin verificar.
 */
export async function verifyTurnstile(
  env: Pick<Env, "TURNSTILE_SECRET_KEY">,
  token: string | null | undefined,
  clientIp: string | undefined,
  timeoutMs = VERIFY_TIMEOUT_MS,
): Promise<void> {
  if (!token || token.length > MAX_TOKEN_LENGTH) throw rejected();

  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET_KEY);
  body.set("response", token);
  if (clientIp) body.set("remoteip", clientIp);

  const response = await fetch(SITEVERIFY_URL, {
    method: "POST",
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Turnstile respondió HTTP ${response.status}.`);
  }

  const outcome = await response.json<{ success?: unknown; "error-codes"?: unknown }>();
  if (outcome.success === true) return;

  const codes = Array.isArray(outcome["error-codes"]) ? outcome["error-codes"] : [];
  if (codes.some((code) => typeof code === "string" && CONFIG_ERRORS.has(code))) {
    throw new Error("TURNSTILE_SECRET_KEY no es válida.");
  }
  throw rejected();
}
