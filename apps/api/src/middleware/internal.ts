import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

const encoder = new TextEncoder();

export const internal = createMiddleware<AppEnv>(async (c, next) => {
  const token = c.req.header("x-mm-internal");
  if (!token) return c.body(null, 404);

  // Las huellas tienen longitud fija, incluso si el encabezado tiene otra longitud.
  const [received, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(token)),
    crypto.subtle.digest("SHA-256", encoder.encode(c.env.INTERNAL_TOKEN)),
  ]);

  if (!crypto.subtle.timingSafeEqual(received, expected)) return c.body(null, 404);

  await next();
});
