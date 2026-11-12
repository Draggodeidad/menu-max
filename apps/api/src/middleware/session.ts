import { createMiddleware } from "hono/factory";
import { readSession } from "../modules/auth/auth.service";
import type { AppEnv } from "../types";

export const session = createMiddleware<AppEnv>(async (c, next) => {
  const current = c.req.header("cookie") ? await readSession(c.env, c.req.raw.headers) : null;
  c.set("user", current?.response?.user ?? null);
  c.set("session", current?.response?.session ?? null);
  for (const cookie of current?.headers.getSetCookie() ?? []) {
    c.header("Set-Cookie", cookie, { append: true });
  }
  await next();
});
