import { JobMessage } from "@menu-max/contracts";
import type { Env } from "../env";

/**
 * Único productor de la cola `jobs` (ADR-011). Valida con Zod antes de enviar: un mensaje
 * inválido es un error de programación y nunca llega a la cola.
 */
export async function enqueue(env: Pick<Env, "JOBS">, message: JobMessage): Promise<void> {
  const result = JobMessage.safeParse(message);
  if (!result.success) {
    // Solo rutas de los campos: los valores pueden incluir correos o enlaces con tokens.
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join(".") || "(raíz)")),
    ];
    throw new Error(`Mensaje de cola inválido en: ${fields.join(", ")}`);
  }
  await env.JOBS.send(result.data, { contentType: "json" });
}
