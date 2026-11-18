import { z } from "zod";
import { PlanFeatures, PlanLimits, PlanUsage } from "./subscriptions";

// Mensajes de la cola `jobs` (ADR-011). Un mensaje que no cumple este esquema va a la DLQ sin reintento.

export const EMAIL_TEMPLATES = [
  "verify-email",
  "reset-password",
  "invitation",
  "password-changed",
  "trial-ending",
  "trial-ended",
  "account-exists",
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

/**
 * Lo que el correo de fin de prueba (T20b) dice del plan al que pasa la cuenta: su nombre,
 * límites y capacidades leídos de `plans` al encolar, y el uso de la organización para avisar
 * solo de lo que ya alcanzó el límite. Ningún límite se escribe a mano en la plantilla.
 */
const TrialPlanData = {
  url: Link,
  planName: DisplayName,
  limits: PlanLimits,
  features: PlanFeatures,
  usage: PlanUsage,
};

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
  EmailSendBase.extend({
    template: z.literal("trial-ending"),
    data: z.strictObject({
      ...TrialPlanData,
      /** Fin de la prueba (ISO 8601): el día en que la cuenta pasa al plan `free`. */
      trialEndsAt: z.iso.datetime(),
      daysLeft: z.int().min(1).max(15),
    }),
  }),
  EmailSendBase.extend({
    template: z.literal("trial-ended"),
    data: z.strictObject(TrialPlanData),
  }),
  // Aviso a un correo que ya tiene cuenta cuando alguien intenta registrarse con él (T20c).
  // Sin datos del intento: solo los enlaces para entrar o restablecer, ninguno con token.
  EmailSendBase.extend({
    template: z.literal("account-exists"),
    data: z.strictObject({ signInUrl: Link, resetUrl: Link }),
  }),
]);
export type EmailSendJob = z.infer<typeof EmailSendJob>;

export const JobMessage = z.discriminatedUnion("type", [EmailSendJob]);
export type JobMessage = z.infer<typeof JobMessage>;
export type JobType = JobMessage["type"];
