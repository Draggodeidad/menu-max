import { Hono } from "hono";
import { healthRoutes } from "./modules/health/health.routes.js";

export function createApp() {
  const app = new Hono();

  app.route("/health", healthRoutes);
  return app;
}
