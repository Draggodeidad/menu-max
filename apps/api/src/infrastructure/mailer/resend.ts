import type { Env } from "../../env";
import { MailerError, type Mailer } from "./mailer";
import { renderEmail } from "./templates";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

/**
 * Solo `400` y `422` son permanentes: Resend rechazó el mensaje y reintentar no lo arregla.
 * Todo lo demás se reintenta, incluidos `401` y `403` (API key o dominio mal configurados):
 * así el mensaje agota los reintentos y queda en la DLQ en lugar de perderse (ADR-020).
 */
export function classifyResendStatus(status: number): MailerError["kind"] {
  return status === 400 || status === 422 ? "permanent" : "transient";
}

/** Adaptador de Resend (ADR-020). Único lugar que lee `RESEND_API_KEY` y llama a su API. */
export function createResendMailer(
  env: Pick<Env, "RESEND_API_KEY" | "EMAIL_FROM">,
  timeoutMs = SEND_TIMEOUT_MS,
): Mailer {
  return {
    async send(mail) {
      const { subject, text, html } = renderEmail(mail);

      let response: Response;
      try {
        response = await fetch(RESEND_EMAILS_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.RESEND_API_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ from: env.EMAIL_FROM, to: [mail.to], subject, text, html }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // Timeout o falla de red: no se sabe si Resend recibió el mensaje.
        throw new MailerError("transient", "Resend no respondió.", { cause: error });
      }

      // El cuerpo no se lee ni se registra: puede repetir el destinatario.
      await response.body?.cancel();
      if (!response.ok) {
        throw new MailerError(
          classifyResendStatus(response.status),
          `Resend rechazó el envío (HTTP ${response.status}).`,
        );
      }
    },
  };
}
