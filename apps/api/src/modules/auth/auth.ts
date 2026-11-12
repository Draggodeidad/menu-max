import { EMAIL_STATUSES } from "@menu-max/contracts";
import * as schema from "@menu-max/database";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth/minimal";
import { haveIBeenPwned } from "better-auth/plugins/haveibeenpwned";
import type { Env } from "../../env";
import { createDb } from "../../infrastructure/db";
import { newId } from "../../shared/ids";

const DAY = 24 * 60 * 60;
export const AUTH_BASE_PATH = "/v1/auth";

export function createAuth(env: Env) {
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
    },
    emailVerification: { expiresIn: DAY },
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
