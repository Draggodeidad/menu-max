import { EMAIL_STATUSES, type EmailTemplate } from "@menu-max/contracts";
import * as schema from "@menu-max/database";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth/minimal";
import { haveIBeenPwned } from "better-auth/plugins/haveibeenpwned";
import type { Env } from "../../env";
import { createDb } from "../../infrastructure/db";
import { enqueue } from "../../infrastructure/jobs";
import { newId } from "../../shared/ids";
import { log } from "../../shared/log";
import { resetPasswordLink, verifyEmailLink } from "./web-links";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
export const AUTH_BASE_PATH = "/v1/auth";

/** Opciones de una sola petición. Viven en la instancia de `createAuth`, nunca en el módulo. */
export type AuthRequestOptions = {
  requestId?: string;
  /** Si existe, los correos se encolan después de responder (`ctx.waitUntil`). */
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Se llama solo si esta petición marcó el correo como verificado. */
  onEmailVerified?: () => void;
  /**
   * No envía `verify-email` al registrarse: la cuenta nace de un enlace de invitación, que ya
   * probó el correo, y se marca verificada en el mismo batch que la membresía (T13).
   */
  skipVerificationEmail?: boolean;
};

type AuthEmail = { to: string; template: Exclude<EmailTemplate, "invitation">; url: string };

/**
 * Encola un correo de auth (ADR-011). Una falla al encolar no rompe el flujo: se registra y el
 * usuario puede pedir otro enlace. Con `waitUntil`, la respuesta no espera a la cola.
 */
export function sendAuthEmail(
  env: Env,
  options: AuthRequestOptions,
  mail: AuthEmail,
): Promise<void> {
  const requestId = options.requestId ?? crypto.randomUUID();
  const task = enqueue(env, {
    type: "email.send",
    id: newId(),
    to: mail.to,
    template: mail.template,
    data: { url: mail.url },
  }).then(
    () => log.info("email.enqueued", { requestId, template: mail.template }),
    (error: unknown) =>
      log.error("email.enqueue_failed", {
        requestId,
        template: mail.template,
        error: error instanceof Error ? error.name : "unknown",
      }),
  );
  if (!options.waitUntil) return task;
  options.waitUntil(task);
  return Promise.resolve();
}

export function createAuth(env: Env, options: AuthRequestOptions = {}) {
  return betterAuth({
    database: drizzleAdapter(createDb(env), { provider: "sqlite", usePlural: true, schema }),
    baseURL: env.WEB_ORIGIN,
    basePath: AUTH_BASE_PATH,
    trustedOrigins: [env.WEB_ORIGIN],
    secret: env.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: HOUR,
      sendResetPassword: ({ user, token }) =>
        sendAuthEmail(env, options, {
          to: user.email,
          template: "reset-password",
          url: resetPasswordLink(env, token),
        }),
      onPasswordReset: ({ user }) =>
        sendAuthEmail(env, options, {
          to: user.email,
          template: "password-changed",
          url: resetPasswordLink(env),
        }),
    },
    emailVerification: {
      sendOnSignUp: !options.skipVerificationEmail,
      autoSignInAfterVerification: true,
      expiresIn: DAY,
      sendVerificationEmail: ({ user, token }) =>
        sendAuthEmail(env, options, {
          to: user.email,
          template: "verify-email",
          url: verifyEmailLink(env, token),
        }),
      afterEmailVerification: () => {
        options.onEmailVerified?.();
        return Promise.resolve();
      },
    },
    verification: { storeIdentifier: "hashed" },
    session: { expiresIn: 7 * DAY, updateAge: DAY },
    user: {
      additionalFields: {
        emailStatus: {
          type: [...EMAIL_STATUSES],
          defaultValue: "ok",
          required: true,
          input: false,
          returned: false,
        },
      },
    },
    advanced: {
      database: { generateId: newId },
      useSecureCookies: env.ENVIRONMENT !== "development",
      ipAddress: { ipAddressHeaders: ["x-client-ip"] },
    },
    rateLimit: { enabled: false },
    logger: { disabled: true },
    telemetry: { enabled: false },
    plugins: [haveIBeenPwned()],
  });
}

type Identity = ReturnType<typeof createAuth>["$Infer"]["Session"];
export type AuthUser = Identity["user"];
export type AuthSession = Identity["session"];
