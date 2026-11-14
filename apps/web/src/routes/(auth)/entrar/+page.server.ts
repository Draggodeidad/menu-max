import { dev } from "$app/env";
import { fail, redirect } from "@sveltejs/kit";
import { abrirSesion } from "#lib/server/sesion.js";
import type { Actions, PageServerLoad } from "./$types";

function invitationDestination(next: string | null): string | null {
  if (!next?.startsWith("/invitacion?token=")) return null;

  const url = new URL(next, "https://menusmax.local");
  const token = url.searchParams.get("token");
  if (!token || !/^[\w-]{1,128}$/.test(token)) return null;

  const query = new URLSearchParams({ token });
  const state = dev ? url.searchParams.get("estado") : null;
  if (state) query.set("estado", state);
  return `/invitacion?${query}`;
}

const privateInvitationHeaders = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

export const load: PageServerLoad = ({ url, request, setHeaders }) => {
  const returningToInvitation = invitationDestination(url.searchParams.get("siguiente")) !== null;
  if (request.method !== "POST" && returningToInvitation) {
    setHeaders(privateInvitationHeaders);
  }
  return { returningToInvitation };
};

export const actions: Actions = {
  default: async ({ request, cookies, url, setHeaders }) => {
    const next = invitationDestination(url.searchParams.get("siguiente"));
    if (next) setHeaders(privateInvitationHeaders);

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

    // TEMPORAL: sin API todavía; cualquier correo válido abre una sesión simulada.
    abrirSesion(cookies, correo);
    redirect(303, next ?? "/app");
  },
};
