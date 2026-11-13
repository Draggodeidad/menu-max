import { createMiddleware } from "hono/factory";
import { AppError } from "../shared/errors";
import type { AppEnv } from "../types";

const BINDINGS = { auth: "RL_AUTH", public: "RL_PUBLIC", private: "RL_PRIVATE" } as const;
export type RateLimitGroup = keyof typeof BINDINGS;

// El binding solo admite ventanas de 10 o 60 s y no dice cuándo se libera: se usa el periodo.
const RETRY_AFTER_SECONDS = 60;

/**
 * Filtro grueso por `ip + grupo` con el binding `ratelimits` (ADR-010). Cuenta por ubicación
 * de Cloudflare, así que no sirve como cuota de negocio: para eso está `shared/rate-counters`.
 */
export function rateLimit(group: RateLimitGroup) {
  return createMiddleware<AppEnv>(async (c, next) => {
    // Sin `x-client-ip` (WEB siempre lo envía) todas las peticiones comparten una llave.
    const key = `${c.var.clientIp ?? "unknown"}:${group}`;
    const { success } = await c.env[BINDINGS[group]].limit({ key });
    if (!success) {
      throw new AppError("RATE_LIMITED", undefined, undefined, RETRY_AFTER_SECONDS);
    }
    await next();
  });
}
