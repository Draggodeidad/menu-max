import { COOKIE_CATALOGO, getCategorias, leerCambiosCatalogo } from "#lib/server/demo.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, cookies, setHeaders }) => {
  // TEMPORAL: el catálogo editado vive en una cookie por navegador, así que la respuesta no
  // puede ser pública ni compartida. Con API se vuelve `public, max-age=60, s-maxage=300`.
  setHeaders({ "cache-control": "private, no-cache" });
  const cambios = leerCambiosCatalogo(cookies.get(COOKIE_CATALOGO));
  return {
    mesa: url.searchParams.get("mesa"),
    categorias: await getCategorias(url, cambios),
  };
};
