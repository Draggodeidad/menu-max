import {
  COOKIE_CATALOGO,
  COOKIE_PUBLICADO,
  categoriasPublicado,
  getCategorias,
  leerCambiosCatalogo,
  publicadoPara,
} from "#lib/server/demo.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, setHeaders, params, cookies }) => {
  const publicado = publicadoPara(params.slug, cookies.get(COOKIE_PUBLICADO));
  // TEMPORAL: tanto el menú publicado como el catálogo editado dependen del navegador.
  setHeaders({ "cache-control": publicado ? "private, no-store" : "private, no-cache" });
  const cambios = leerCambiosCatalogo(cookies.get(COOKIE_CATALOGO));
  return {
    mesa: url.searchParams.get("mesa"),
    categorias: publicado ? categoriasPublicado(publicado) : await getCategorias(url, cambios),
  };
};
