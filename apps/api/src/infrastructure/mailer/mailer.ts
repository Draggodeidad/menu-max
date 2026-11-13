import type { EmailSendJob } from "@menu-max/contracts";
import type { Env } from "../../env";
import { createCloudflareMailer } from "./cloudflare";
import { createConsoleMailer } from "./console";

type WithoutEnvelope<T> = T extends unknown ? Omit<T, "type" | "id"> : never;

/** Correo por enviar: destinatario, plantilla y los datos que esa plantilla necesita. */
export type Mail = WithoutEnvelope<EmailSendJob>;

/** Puerto de correo (ADR-009). Ningún archivo fuera de `infrastructure/mailer` usa `env.EMAIL`. */
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export type MailerErrorKind = "transient" | "permanent";

/** `transient`: conviene reintentar. `permanent`: reintentar no cambiaría el resultado. */
export class MailerError extends Error {
  constructor(
    readonly kind: MailerErrorKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MailerError";
  }
}

export function createMailer(env: Env): Mailer {
  return env.ENVIRONMENT === "development" ? createConsoleMailer() : createCloudflareMailer(env);
}
