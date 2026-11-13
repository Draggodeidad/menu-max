import { JobMessage, type JobType } from "@menu-max/contracts";
import type { Env } from "../env";
import { log } from "../shared/log";
import { handleEmailSend } from "./email.handler";

type Handlers = {
  [Type in JobType]: (job: Extract<JobMessage, { type: Type }>, env: Env) => Promise<void>;
};

const handlers: Handlers = {
  "email.send": handleEmailSend,
};

/** Retraso por intento fallido (`attempts` empieza en 1). Tras `max_retries: 5`, Queues lo manda a la DLQ. */
export const RETRY_DELAYS_SECONDS = [30, 60, 120, 240, 480] as const;

const MAX_RETRY_DELAY_SECONDS = 480;

export function retryDelaySeconds(attempts: number): number {
  return RETRY_DELAYS_SECONDS[Math.max(attempts, 1) - 1] ?? MAX_RETRY_DELAY_SECONDS;
}

/** Los handlers marcan con `kind: "permanent"` lo que reintentar no arregla (p. ej. `MailerError`). */
function isPermanent(error: unknown): boolean {
  return error instanceof Error && "kind" in error && error.kind === "permanent";
}

function dispatch(job: JobMessage, env: Env): Promise<void> {
  const handler = handlers[job.type] as (job: JobMessage, env: Env) => Promise<void>;
  return handler(job, env);
}

// En la cola no hay petición HTTP: el id del mensaje de Queues hace de `requestId` en los logs.
// Nunca se registra el cuerpo del mensaje (lleva correos y enlaces con tokens).
async function consume(message: Message<unknown>, env: Env): Promise<void> {
  const parsed = JobMessage.safeParse(message.body);
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "(raíz)")),
    ];
    try {
      await env.JOBS_DLQ.send(message.body);
    } catch (error) {
      log.error("job.dead_letter_failed", {
        requestId: message.id,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
      return;
    }
    message.ack();
    log.error("job.invalid", { requestId: message.id, attempts: message.attempts, fields });
    return;
  }

  const job = parsed.data;
  const context = {
    requestId: message.id,
    jobId: job.id,
    type: job.type,
    attempts: message.attempts,
  };
  try {
    await dispatch(job, env);
    message.ack();
    log.info("job.completed", context);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : typeof error;
    if (isPermanent(error)) {
      message.ack();
      log.error("job.failed_permanently", { ...context, errorName });
      return;
    }
    const delaySeconds = retryDelaySeconds(message.attempts);
    message.retry({ delaySeconds });
    log.warn("job.retry_scheduled", { ...context, errorName, delaySeconds });
  }
}

/** Único consumidor de la cola `jobs`. Cada mensaje se confirma o reintenta por separado. */
export async function consumeBatch(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  await Promise.all(batch.messages.map((message) => consume(message, env)));
}
