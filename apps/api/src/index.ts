import { createApp } from "./app";
import { getEnv } from "./env";

const app = createApp();

export default {
  fetch(request, env, ctx) {
    const bindings = getEnv(env);
    const router = bindings.ENVIRONMENT === "development" ? createApp(bindings.ENVIRONMENT) : app;
    return router.fetch(request, bindings, ctx);
  },
} satisfies ExportedHandler<Record<string, unknown>>;
