import { fail } from "@sveltejs/kit";
import { getEntrega, getNegocio, simulaError } from "#lib/server/demo.js";
import type { Actions, PageServerLoad } from "./$types";

// Clave de idempotencia del envío (DESIGN.md §7.2-I), generada en `load`.
export const load: PageServerLoad = ({ url, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });
  return {
    mesa: url.searchParams.get("mesa"),
    idempotencyKey: crypto.randomUUID(),
    entrega: getEntrega(), // TEMPORAL: sin API todavía
  };
};

type Campo = "nombre" | "telefono" | "direccion" | "notas";

export const actions: Actions = {
  enviar: async ({ request, url, params }) => {
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

    const texto = (name: string) => String(form.get(name) ?? "").trim();
    const mesa = url.searchParams.get("mesa");
    const pedida = texto("modalidad");
    const modalidad = mesa ? "mesa" : pedida === "domicilio" ? "domicilio" : "recoger";
    const values = {
      modalidad,
      nombre: texto("nombre"),
      telefono: texto("telefono"),
      direccion: texto("direccion"),
      notas: texto("notas"),
    };

    const fieldErrors: Partial<Record<Campo, string>> = {};
    if (values.nombre.length < 2) {
      fieldErrors.nombre = "Escribe tu nombre para que el negocio sepa a quién entregar.";
    }
    if (values.telefono.replace(/\D/g, "").length !== 10) {
      fieldErrors.telefono = "Escribe tu teléfono de 10 dígitos para confirmar tu pedido.";
    }
    if (modalidad === "domicilio" && values.direccion.length < 5) {
      fieldErrors.direccion = "Escribe calle, número y colonia para el domicilio.";
    }
    if (values.notas.length > 200) {
      fieldErrors.notas = "Acorta las notas a 200 caracteres.";
    }
    if (Object.keys(fieldErrors).length > 0) {
      return fail(400, { fieldErrors, values });
    }

    // TEMPORAL: sin API todavía. El cliente solo manda ids y cantidades; la API
    // recalculará precios, total y disponibilidad, y validará el horario.
    // Las banderas de desarrollo se leen del referer porque la action no conserva la query.
    const origen = new URL(request.headers.get("referer") ?? url);
    const negocio = getNegocio(params.slug, origen);
    if (!negocio.abierto) {
      return fail(409, { error: `Estamos cerrados. Abrimos a las ${negocio.abre}.`, values });
    }
    if (simulaError(origen)) {
      return fail(409, {
        error: "Este producto ya no está disponible. Quítalo para continuar.",
        values,
      });
    }
    return { enviado: true };
  },
};
