import { Hono } from "hono";
import type { AppEnv } from "./types";

export function createApp() {
  const app = new Hono<AppEnv>();

  app.get("/v1/health", (c) => c.json({ status: "ok", environment: c.env.ENVIRONMENT }));

  return app;
}
