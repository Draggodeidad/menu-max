import { createApp } from "./app";
import { getEnv } from "./env";

const app = createApp();

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, getEnv(env), ctx);
  },
} satisfies ExportedHandler<Record<string, unknown>>;
