import { z } from "zod";

// Mensajes de la cola `jobs` (ADR-011). Un mensaje que no cumple este esquema va a la DLQ sin reintento.

export const EMAIL_TEMPLATES = [
  "verify-email",
  "reset-password",
  "invitation",
  "password-changed",
] as const;

export const EmailTemplate = z.enum(EMAIL_TEMPLATES);
export type EmailTemplate = z.infer<typeof EmailTemplate>;

const Link = z.url({ protocol: /^https?$/ }).max(2048);
// Sin caracteres de control: estos textos llegan al asunto del correo.
const DisplayName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[^\p{Cc}]+$/u);

const EmailSendBase = z.strictObject({
  type: z.literal("email.send"),
  id: z.uuid(),
  to: z.email().max(254),
});

export const EmailSendJob = z.discriminatedUnion("template", [
  EmailSendBase.extend({
    template: z.literal("verify-email"),
    data: z.strictObject({ url: Link }),
  }),
  EmailSendBase.extend({
    template: z.literal("reset-password"),
    data: z.strictObject({ url: Link }),
  }),
  EmailSendBase.extend({
    template: z.literal("invitation"),
    data: z.strictObject({ url: Link, organizationName: DisplayName, inviterName: DisplayName }),
  }),
  EmailSendBase.extend({
    template: z.literal("password-changed"),
    data: z.strictObject({ url: Link }),
  }),
]);
export type EmailSendJob = z.infer<typeof EmailSendJob>;

export const JobMessage = z.discriminatedUnion("type", [EmailSendJob]);
export type JobMessage = z.infer<typeof JobMessage>;
export type JobType = JobMessage["type"];
