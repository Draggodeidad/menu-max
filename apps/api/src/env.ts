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

function rateLimitBinding(name: string) {
  return z.custom<RateLimit>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      typeof (value as { limit?: unknown }).limit === "function",
    { message: `Falta el binding de rate limit ${name}` },
  );
}

const R2Binding = z.custom<R2Bucket>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { put?: unknown }).put === "function" &&
    typeof (value as { delete?: unknown }).delete === "function",
  { message: "Falta el binding R2 o no es un bucket" },
);

/** Base de las URLs públicas: sin diagonal final, parámetros ni fragmento. */
function isBaseUrl(value: string): boolean {
  const url = URL.parse(value);
  return url !== null && !value.endsWith("/") && url.search === "" && url.hash === "";
}

// «MenusMax <no-responder@dominio>» o solo «no-responder@dominio».
const EMAIL_FROM_FORMAT = /^(?:([^<>\p{Cc}]+?)\s*<([^<>\s]+)>|([^<>\s]+))$/u;

/** Resend recibe `EMAIL_FROM` tal cual (ADR-020); aquí solo se valida su formato. */
function isEmailFrom(value: string): boolean {
  const match = EMAIL_FROM_FORMAT.exec(value.trim());
  const email = match?.[2] ?? match?.[3];
  return email !== undefined && z.email().safeParse(email).success;
}

export const EnvSchema = z.object({
  ENVIRONMENT: Environment,
  INTERNAL_TOKEN: z.string().min(32),
  BETTER_AUTH_SECRET: z.string().min(32),
  WEB_ORIGIN: z.url({ protocol: /^https?$/ }).refine((url) => URL.parse(url)?.origin === url, {
    message: "Usa el origen de WEB, sin ruta, parámetros ni diagonal final.",
  }),
  EMAIL_FROM: z.string().refine(isEmailFrom, {
    message: "Usa el formato «MenusMax <no-responder@tu-dominio>».",
  }),
  // Secreto de Resend (ADR-020). Solo lo lee `infrastructure/mailer/resend.ts`.
  RESEND_API_KEY: z.string().min(1),
  // Secreto de Turnstile (ADR-010). En development y pruebas, la clave de prueba de Cloudflare.
  TURNSTILE_SECRET_KEY: z.string().min(1),
  // Dominio público del bucket MEDIA (T17), configurado por un humano. Los DTO arman con él las
  // URLs de las imágenes; el frontend nunca construye rutas de R2.
  MEDIA_PUBLIC_BASE_URL: z.url({ protocol: /^https?$/ }).refine(isBaseUrl, {
    message: "Usa el dominio público del bucket, sin diagonal final, parámetros ni fragmento.",
  }),
  DB: D1Binding,
  // Imágenes del panel (T17).
  MEDIA: R2Binding,
  JOBS: queueBinding<JobMessage>("JOBS"),
  JOBS_DLQ: queueBinding<unknown>("JOBS_DLQ"),
  // Filtro grueso por IP y grupo de rutas (ADR-010); las cuotas exactas viven en D1.
  RL_AUTH: rateLimitBinding("RL_AUTH"),
  RL_PUBLIC: rateLimitBinding("RL_PUBLIC"),
  RL_PRIVATE: rateLimitBinding("RL_PRIVATE"),
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
