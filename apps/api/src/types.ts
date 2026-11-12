import type { Env } from "./env";

export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    clientIp: string | undefined;
    userAgent: string | undefined;
  };
};
