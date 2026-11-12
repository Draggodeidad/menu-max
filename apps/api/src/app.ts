import { Hono } from "hono";
import { createDb, pingDb } from "./infrastructure/db";
import type { AppEnv } from "./types";

export function createApp() {
  const app = new Hono<AppEnv>();

  app.get("/v1/health", async (c) => {
    await pingDb(createDb(c.env));
    return c.json({ status: "ok", environment: c.env.ENVIRONMENT, db: "ok" });
  });

  return app;
}
