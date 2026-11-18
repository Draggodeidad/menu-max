import { createApp } from "./app";
import { getEnv } from "./env";
import { createDb } from "./infrastructure/db";
import { consumeBatch } from "./jobs/consumer";
import { deleteStaleEmailDomainChecks } from "./shared/email-checks";
import { deleteExpiredIdempotencyKeys } from "./shared/idempotency";
import { log } from "./shared/log";
import { deleteExpiredRateCounters } from "./shared/rate-counters";
import {
  endExpiredTrials,
  sendTrialEndedNotices,
  sendTrialNotices,
} from "./modules/subscriptions/subscriptions.service";

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
  // Cron diario `0 9 * * *` (3:00 en Ciudad de México): limpieza de anti-abuso (ADR-010), de
  // llaves de idempotencia vencidas (ADR-013) y fin de la prueba (T20b). Las tareas son
  // independientes: si una falla, las demás terminan; al final la corrida falla si alguna falló.
  async scheduled(controller, env) {
    const bindings = getEnv(env);
    const db = createDb(bindings);
    const now = controller.scheduledTime;
    // Sin petición HTTP: un UUID hace de `requestId` (redact() no altera los UUID).
    const requestId = crypto.randomUUID();
    const deps = { db, env: bindings, requestId };

    const trialsEnded = endExpiredTrials(deps, now);
    const tasks = {
      rateCounters: deleteExpiredRateCounters(db, now),
      emailDomainChecks: deleteStaleEmailDomainChecks(db, now),
      idempotencyKeys: deleteExpiredIdempotencyKeys(db, now),
      trialNotices: sendTrialNotices(deps, now),
      trialsEnded,
      // Después del cambio de plan, para que el aviso salga en la misma corrida. Si el cambio
      // falla, igual se encolan los avisos que quedaron pendientes de corridas anteriores.
      trialEndedNotices: trialsEnded
        .catch(() => undefined)
        .then(() => sendTrialEndedNotices(deps, now)),
    };
    const names = Object.keys(tasks) as (keyof typeof tasks)[];
    const settled = await Promise.allSettled(Object.values(tasks));

    const results: Record<string, unknown> = {};
    const failed: string[] = [];
    settled.forEach((result, index) => {
      const task = names[index] ?? "unknown";
      if (result.status === "fulfilled") {
        results[task] = result.value;
        return;
      }
      failed.push(task);
      log.error("cron.task_failed", {
        requestId,
        task,
        errorName: result.reason instanceof Error ? result.reason.name : typeof result.reason,
      });
    });
    log.info("maintenance.cleanup", { requestId, cron: controller.cron, ...results });
    if (failed.length > 0) throw new Error(`Fallaron tareas del Cron: ${failed.join(", ")}`);
  },
} satisfies ExportedHandler<Record<string, unknown>>;
