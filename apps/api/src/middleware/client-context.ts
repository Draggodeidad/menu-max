import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

export const clientContext = createMiddleware<AppEnv>((c, next) => {
  c.set("clientIp", c.req.header("x-client-ip"));
  c.set("userAgent", c.req.header("user-agent"));
  return next();
});
