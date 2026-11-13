import type { EmailSendJob } from "@menu-max/contracts";
import type { Env } from "../env";
import { createMailer } from "../infrastructure/mailer/mailer";

/**
 * `email.send`: envía el correo con el adaptador del entorno. No se deduplica: un correo de auth
 * repetido por reentrega de la cola es aceptable (ADR-011). Los errores del mailer llevan su
 * `kind` y el consumidor decide si reintentar.
 */
export async function handleEmailSend(job: EmailSendJob, env: Env): Promise<void> {
  const { type: _type, id: _id, ...mail } = job;
  await createMailer(env).send(mail);
}
