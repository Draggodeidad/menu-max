import { z } from "zod";

const D1Binding = z.custom<D1Database>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { prepare?: unknown }).prepare === "function",
  { message: "Falta el binding D1 o no es una base D1" },
);

export const EnvSchema = z.object({
  ENVIRONMENT: z.enum(["development", "staging", "production"]),
  INTERNAL_TOKEN: z.string().min(32),
  DB: D1Binding,
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
