import type { Cookies } from "@sveltejs/kit";

// TEMPORAL: sin API todavía. Sesión simulada por navegador, aislada en este archivo para
// reemplazarla por la sesión real. No autentica a nadie: solo marca que este navegador
// completó el acceso o la publicación demo. Cualquier valor con forma de UUID se acepta.
export const COOKIE_SESION = "demo_sesion";

export type SesionDemo = { id: string; email: string | null };

const FORMA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function leerSesion(cookies: Cookies): SesionDemo | null {
  const value = cookies.get(COOKIE_SESION) ?? "";
  const separator = value.indexOf(":");
  if (separator === -1) return FORMA_ID.test(value) ? { id: value, email: null } : null;

  const id = value.slice(0, separator);
  return FORMA_ID.test(id) ? { id, email: value.slice(separator + 1) || null } : null;
}

export function abrirSesion(cookies: Cookies, email?: string): SesionDemo {
  const current = leerSesion(cookies);
  const sesion = {
    id: current?.id ?? crypto.randomUUID(),
    email: email?.toLowerCase() ?? current?.email ?? null,
  };
  cookies.set(COOKIE_SESION, sesion.email ? `${sesion.id}:${sesion.email}` : sesion.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
  });
  return sesion;
}
