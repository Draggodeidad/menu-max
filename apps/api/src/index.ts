import { createApp } from "./app";
import { getEnv } from "./env";
import { consumeBatch } from "./jobs/consumer";

const app = createApp();

export default {
  fetch(request, env, ctx) {
    const bindings = getEnv(env);
    const router = bindings.ENVIRONMENT === "development" ? createApp(bindings.ENVIRONMENT) : app;
    return router.fetch(request, bindings, ctx);
  },
  async queue(batch, env) {
    await consumeBatch(batch, getEnv(env));
  },
} satisfies ExportedHandler<Record<string, unknown>>;
