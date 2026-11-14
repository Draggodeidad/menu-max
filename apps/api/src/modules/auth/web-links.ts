import type { Env } from "../../env";

// Única fuente de las URLs hacia pantallas de WEB que la API pone en correos. Los enlaces nunca
// apuntan a la API: WEB recibe el token y lo resuelve llamando a la API por Service Binding.
// Las rutas deben coincidir con `apps/web/src/routes` (pantallas pendientes en DESIGN.md §7).
export const WEB_ROUTES = {
  verifyEmail: "/verificar-correo",
  resetPassword: "/restablecer",
  invitation: "/invitacion",
} as const;

function webLink(env: Pick<Env, "WEB_ORIGIN">, path: string, token?: string): string {
  const url = new URL(path, env.WEB_ORIGIN);
  if (token !== undefined) url.searchParams.set("token", token);
  return url.href;
}

/** `${WEB_ORIGIN}/verificar-correo?token=…` */
export function verifyEmailLink(env: Pick<Env, "WEB_ORIGIN">, token: string): string {
  return webLink(env, WEB_ROUTES.verifyEmail, token);
}

/** `${WEB_ORIGIN}/restablecer?token=…`; sin token, la pantalla para pedir un enlace nuevo. */
export function resetPasswordLink(env: Pick<Env, "WEB_ORIGIN">, token?: string): string {
  return webLink(env, WEB_ROUTES.resetPassword, token);
}

/** `${WEB_ORIGIN}/invitacion?token=…` */
export function invitationLink(env: Pick<Env, "WEB_ORIGIN">, token: string): string {
  return webLink(env, WEB_ROUTES.invitation, token);
}
