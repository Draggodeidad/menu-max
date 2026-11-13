import { createApp } from "./app";
import { getEnv } from "./env";
import { createDb } from "./infrastructure/db";
import { consumeBatch } from "./jobs/consumer";
import { deleteStaleEmailDomainChecks } from "./shared/email-checks";
import { log } from "./shared/log";
import { deleteExpiredRateCounters } from "./shared/rate-counters";

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
  // Cron diario `0 9 * * *` (3:00 en Ciudad de México): limpieza de anti-abuso (ADR-010).
  async scheduled(controller, env) {
    const db = createDb(getEnv(env));
    const now = controller.scheduledTime;
    const [rateCounters, emailDomainChecks] = await Promise.all([
      deleteExpiredRateCounters(db, now),
      deleteStaleEmailDomainChecks(db, now),
    ]);
    log.info("maintenance.cleanup", {
      // Sin petición HTTP: un UUID hace de `requestId` (redact() no altera los UUID).
      requestId: crypto.randomUUID(),
      cron: controller.cron,
      rateCounters,
      emailDomainChecks,
    });
  },
} satisfies ExportedHandler<Record<string, unknown>>;
