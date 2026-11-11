import {
  COOKIE_CATALOGO,
  COOKIE_PUBLICADO,
  MenuError,
  categoriasPublicado,
  getCategorias,
  leerCambiosCatalogo,
  publicadoPara,
} from "#lib/server/demo.js";
import { dev } from "$app/env";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, setHeaders, params, cookies }) => {
  const publicado = publicadoPara(params.slug, cookies.get(COOKIE_PUBLICADO));
  // TEMPORAL: tanto el menú publicado como el catálogo editado dependen del navegador.
  setHeaders({ "cache-control": publicado ? "private, no-store" : "private, no-cache" });
  const cambios = leerCambiosCatalogo(cookies.get(COOKIE_CATALOGO));
  // TEMPORAL: el menú publicado también permite probar el fallo de lectura en desarrollo.
  let categorias: Awaited<ReturnType<typeof getCategorias>>;
  let errorCarga = false;
  try {
    if (dev && url.searchParams.get("error") === "1" && publicado) {
      throw new MenuError("demo: error de carga del menú");
    }
    categorias = publicado ? categoriasPublicado(publicado) : await getCategorias(url, cambios);
  } catch (error) {
    if (!(error instanceof MenuError)) throw error;
    categorias = [];
    errorCarga = true;
  }
  return {
    mesa: url.searchParams.get("mesa"),
    categorias,
    errorCarga,
  };
};
