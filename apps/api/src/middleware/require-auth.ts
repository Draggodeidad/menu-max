import { createMiddleware } from "hono/factory";
import { AppError } from "../shared/errors";
import type { AuthenticatedEnv } from "../types";

export const requireAuth = createMiddleware<AuthenticatedEnv>((c, next) => {
  if (!c.var.user || !c.var.session) throw new AppError("AUTH_REQUIRED");
  return next();
});
