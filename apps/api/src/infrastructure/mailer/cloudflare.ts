import { parseEmailFrom, type Env } from "../../env";
import { MailerError, type Mailer } from "./mailer";
import { renderEmail } from "./templates";

const SEND_TIMEOUT_MS = 10_000;

// Email Service está en beta (ADR-009) y no documenta códigos de error estables. Solo se trata
// como permanente lo que reintentar no arregla: remitente o destinatario inválido, no verificado,
// suprimido o sin permiso. Todo lo demás (incluido lo desconocido) se reintenta y acaba en la DLQ.
const PERMANENT_ERROR =
  /not verified|unverified|invalid (?:recipient|sender|address|from|to)|suppress|not allowed|not permitted|forbidden/i;

export function classifyEmailError(error: unknown): MailerError["kind"] {
  const message = error instanceof Error ? error.message : String(error);
  return PERMANENT_ERROR.test(message) ? "permanent" : "transient";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new MailerError("transient", "Email Service no respondió a tiempo.")),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Adaptador de Cloudflare Email Service (binding `send_email` llamado `EMAIL`). */
export function createCloudflareMailer(
  env: Pick<Env, "EMAIL" | "EMAIL_FROM">,
  timeoutMs = SEND_TIMEOUT_MS,
): Mailer {
  return {
    async send(mail) {
      const from = parseEmailFrom(env.EMAIL_FROM);
      if (!from) throw new MailerError("permanent", "EMAIL_FROM no tiene un formato válido.");

      const { subject, text, html } = renderEmail(mail);
      try {
        await withTimeout(env.EMAIL.send({ from, to: mail.to, subject, text, html }), timeoutMs);
      } catch (error) {
        if (error instanceof MailerError) throw error;
        throw new MailerError(classifyEmailError(error), "Email Service rechazó el envío.", {
          cause: error,
        });
      }
    },
  };
}
