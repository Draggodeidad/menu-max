import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const forwarded = c.req.header("x-request-id");
  const id = forwarded && UUID.test(forwarded) ? forwarded : crypto.randomUUID();

  c.set("requestId", id);
  c.header("x-request-id", id);
  c.header("Cache-Control", "no-store");

  try {
    await next();
  } catch (error) {
    // Hono solo envía instancias de Error a onError.
    throw error instanceof Error ? error : new Error("Se lanzó un valor sin instancia de Error.");
  }
});
