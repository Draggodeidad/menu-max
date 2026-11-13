import { Environment, type JobMessage } from "@menu-max/contracts";
import { z } from "zod";

const D1Binding = z.custom<D1Database>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { prepare?: unknown }).prepare === "function",
  { message: "Falta el binding D1 o no es una base D1" },
);

function queueBinding<Body>(name: string) {
  return z.custom<Queue<Body>>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      typeof (value as { send?: unknown }).send === "function" &&
      typeof (value as { sendBatch?: unknown }).sendBatch === "function",
    { message: `Falta el binding de cola ${name}` },
  );
}

const SendEmailBinding = z.custom<SendEmail>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { send?: unknown }).send === "function",
  { message: "Falta el binding send_email EMAIL" },
);

// «MenusMax <no-responder@dominio>» o solo «no-responder@dominio».
const EMAIL_FROM_FORMAT = /^(?:([^<>\p{Cc}]+?)\s*<([^<>\s]+)>|([^<>\s]+))$/u;

/** Remitente para Email Service; `undefined` si `EMAIL_FROM` no tiene un formato válido. */
export function parseEmailFrom(value: string): string | EmailAddress | undefined {
  const match = EMAIL_FROM_FORMAT.exec(value.trim());
  const email = match?.[2] ?? match?.[3];
  if (!email || !z.email().safeParse(email).success) return undefined;
  const name = match?.[1]?.trim();
  return name ? { name, email } : email;
}

export const EnvSchema = z.object({
  ENVIRONMENT: Environment,
  INTERNAL_TOKEN: z.string().min(32),
  BETTER_AUTH_SECRET: z.string().min(32),
  WEB_ORIGIN: z.url({ protocol: /^https?$/ }).refine((url) => URL.parse(url)?.origin === url, {
    message: "Usa el origen de WEB, sin ruta, parámetros ni diagonal final.",
  }),
  EMAIL_FROM: z.string().refine((value) => parseEmailFrom(value) !== undefined, {
    message: "Usa el formato «MenusMax <no-responder@tu-dominio>».",
  }),
  // Secreto de Resend (ADR-020). Solo lo lee `infrastructure/mailer/resend.ts`.
  RESEND_API_KEY: z.string().min(1),
  DB: D1Binding,
  JOBS: queueBinding<JobMessage>("JOBS"),
  JOBS_DLQ: queueBinding<unknown>("JOBS_DLQ"),
  EMAIL: SendEmailBinding,
});

export type Env = z.infer<typeof EnvSchema>;

// Caché por objeto de bindings: no comparte datos entre peticiones, solo evita revalidar.
const validated = new WeakMap<object, Env>();

export function getEnv(raw: unknown): Env {
  if (typeof raw === "object" && raw !== null) {
    const cached = validated.get(raw);
    if (cached) return cached;
  }

  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    // Solo nombres de variables y reglas; nunca valores (pueden ser secretos).
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(env)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Configuración de entorno inválida: ${problems}`);
  }

  if (typeof raw === "object" && raw !== null) validated.set(raw, result.data);
  return result.data;
}
