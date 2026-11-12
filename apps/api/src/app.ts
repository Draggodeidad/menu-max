import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { createDb, pingDb } from "./infrastructure/db";
import { clientContext } from "./middleware/client-context";
import { internal } from "./middleware/internal";
import { requestId } from "./middleware/request-id";
import { AppError, notFound, onError } from "./shared/errors";
import type { AppEnv } from "./types";

export function createApp() {
  const app = new Hono<AppEnv>();

  app.onError(onError);
  app.notFound(notFound);
  app.use(
    "*",
    requestId,
    internal,
    clientContext,
    bodyLimit({
      maxSize: 64 * 1024,
      onError: () => {
        throw new AppError("PAYLOAD_TOO_LARGE");
      },
    }),
    secureHeaders(),
  );

  app.get("/v1/health", async (c) => {
    await pingDb(createDb(c.env));
    return c.json({ status: "ok", environment: c.env.ENVIRONMENT, db: "ok" });
  });

  return app;
}
