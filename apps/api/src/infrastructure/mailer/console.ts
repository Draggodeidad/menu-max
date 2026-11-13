import type { Mailer } from "./mailer";
import { renderEmail } from "./templates";

/**
 * Solo development: imprime el correo en la terminal de `wrangler dev` en lugar de enviarlo.
 * Usa `console` directo y no `log.*` a propósito: el destinatario y el enlace son lo que se
 * necesita ver en local, y `redact()` los ocultaría. Nunca se elige fuera de development.
 */
export function createConsoleMailer(): Mailer {
  return {
    send(mail) {
      const { subject } = renderEmail(mail);
      console.info(
        [
          "── Correo (development; no se envió) ──",
          `Para: ${mail.to}`,
          `Asunto: ${subject}`,
          `Enlace: ${mail.data.url}`,
        ].join("\n"),
      );
      return Promise.resolve();
    },
  };
}
