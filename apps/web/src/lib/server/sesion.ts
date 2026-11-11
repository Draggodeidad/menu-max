import type { Cookies } from "@sveltejs/kit";

// TEMPORAL: sin API todavía. Sesión simulada por navegador, aislada en este archivo para
// reemplazarla por la sesión real. No autentica a nadie: solo marca que este navegador
// completó el acceso o la publicación demo. Cualquier valor con forma de UUID se acepta.
export const COOKIE_SESION = "demo_sesion";

export type SesionDemo = { id: string };

const FORMA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function leerSesion(cookies: Cookies): SesionDemo | null {
  const id = cookies.get(COOKIE_SESION);
  return id && FORMA_ID.test(id) ? { id } : null;
}

export function abrirSesion(cookies: Cookies): SesionDemo {
  const sesion = leerSesion(cookies) ?? { id: crypto.randomUUID() };
  cookies.set(COOKIE_SESION, sesion.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
  });
  return sesion;
}
