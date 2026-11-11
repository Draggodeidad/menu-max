import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

// Clave de idempotencia del envío (DESIGN.md §7.2-I), generada en `load`.
export const load: PageServerLoad = ({ url, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });
  return {
    mesa: url.searchParams.get("mesa"),
    idempotencyKey: crypto.randomUUID(),
  };
};

export const actions: Actions = {
  enviar: async ({ request }) => {
    const form = await request.formData();
    const ids = form.getAll("id").map(String);
    const cantidades = form.getAll("cantidad").map(Number);

    const valido =
      ids.length > 0 &&
      ids.length === cantidades.length &&
      cantidades.every((n) => Number.isInteger(n) && n >= 1 && n <= 99);
    if (!valido) {
      return fail(400, {
        error: "Tu pedido está vacío. Agrega un producto para continuar.",
      });
    }

    // TEMPORAL: sin API todavía. El cliente solo manda ids y cantidades; la API
    // recalculará precios, total y disponibilidad, y validará el horario.
    return { enviado: true };
  },
};
