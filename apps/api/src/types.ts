import type { Env } from "./env";
import type { AuthSession, AuthUser } from "./modules/auth/auth";

export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    clientIp: string | undefined;
    userAgent: string | undefined;
    user: AuthUser | null;
    session: AuthSession | null;
  };
};

export type AuthenticatedEnv = {
  Bindings: Env;
  Variables: AppEnv["Variables"] & { user: AuthUser; session: AuthSession };
};
