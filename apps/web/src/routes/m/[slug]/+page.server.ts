import {
  COOKIE_PUBLICADO,
  categoriasPublicado,
  getCategorias,
  publicadoPara,
} from "#lib/server/demo.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, setHeaders, params, cookies }) => {
  // TEMPORAL: el menú publicado depende de la cookie del navegador, así que no se cachea.
  const publicado = publicadoPara(params.slug, cookies.get(COOKIE_PUBLICADO));
  setHeaders({
    "cache-control": publicado ? "private, no-store" : "public, max-age=60, s-maxage=300",
  });
  return {
    mesa: url.searchParams.get("mesa"),
    categorias: publicado ? categoriasPublicado(publicado) : await getCategorias(url),
  };
};
