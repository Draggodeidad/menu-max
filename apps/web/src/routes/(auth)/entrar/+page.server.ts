import { fail, redirect } from "@sveltejs/kit";
import type { Actions } from "./$types";

export const actions: Actions = {
  default: async ({ request }) => {
    const data = await request.formData();
    const correo = String(data.get("correo") ?? "").trim();
    const contrasena = String(data.get("contrasena") ?? "");
    const fieldErrors = {
      correo: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)
        ? ""
        : "Escribe un correo electrónico válido.",
      contrasena: contrasena ? "" : "Escribe tu contraseña.",
    };

    if (fieldErrors.correo || fieldErrors.contrasena) {
      return fail(400, { fieldErrors, values: { correo } });
    }

    // TEMPORAL: sin API todavía; el panel ya usa una sesión simulada.
    redirect(303, "/app");
  },
};
