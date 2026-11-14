import { dev } from "$app/env";
import { ERROR_HTTP_STATUS } from "@menu-max/contracts";
import { fail, redirect } from "@sveltejs/kit";
import {
  acceptDemoInvitation,
  demoInvitationEmail,
  invitationExpired,
  invitationGone,
  invitationOtherEmail,
  invitationSignIn,
  previewDemoInvitation,
} from "#lib/server/demo.js";
import { abrirSesion } from "#lib/server/sesion.js";
import type { Actions, PageServerLoad } from "./$types";

// TEMPORAL: con la API, el canje del token persiste en el servidor.
const CLAIM_COOKIE = "demo_invitacion_aceptada";
const privateHeaders = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

export const load: PageServerLoad = ({ url, request, cookies, locals, setHeaders }) => {
  if (request.method !== "POST") setHeaders(privateHeaders);

  const invitation = previewDemoInvitation(url, cookies.get(CLAIM_COOKIE) === "1");
  if (!invitation) return { invitation, message: invitationGone };

  const query = new URLSearchParams({ token: url.searchParams.get("token") ?? "" });
  const state = dev ? url.searchParams.get("estado") : null;
  if (state) query.set("estado", state);

  const next = new URLSearchParams({ siguiente: `/invitacion?${query}` });
  return {
    invitation,
    message: invitation.expired ? invitationExpired : invitationSignIn,
    hasSession: locals.session !== null,
    acceptAction: `?/aceptar&${query}`,
    signInHref: `/entrar?${next}`,
  };
};

export const actions: Actions = {
  aceptar: async ({ url, request, cookies, locals, setHeaders }) => {
    setHeaders(privateHeaders);
    const claimed = cookies.get(CLAIM_COOKIE) === "1";
    const form = await request.formData();
    const submittedName = form.get("name");
    const submittedPassword = form.get("password");
    const name = typeof submittedName === "string" ? submittedName.trim() : "";
    const password = typeof submittedPassword === "string" ? submittedPassword : "";

    // TEMPORAL: se simula la respuesta de la API, incluida la validación de Turnstile.
    const result = acceptDemoInvitation(url, claimed, locals.session, { name, password });
    if ("error" in result) {
      const { code, message, fieldErrors } = result.error;
      return fail(ERROR_HTTP_STATUS[code], {
        message,
        fieldErrors,
        needsSignIn: code === "AUTH_REQUIRED" || message === invitationOtherEmail,
        values: { name: name.slice(0, 120) },
      });
    }

    if (!locals.session) abrirSesion(cookies, demoInvitationEmail);
    cookies.set(CLAIM_COOKIE, "1", {
      path: "/invitacion",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
    });
    redirect(303, "/app");
  },
};
