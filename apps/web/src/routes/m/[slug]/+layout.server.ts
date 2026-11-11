import {
  COOKIE_AJUSTES,
  COOKIE_PUBLICADO,
  getNegocio,
  leerAjustesDemo,
  publicadoPara,
  resolverTema,
} from "#lib/server/demo.js";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ params, url, cookies }) => {
  const publicado = publicadoPara(params.slug, cookies.get(COOKIE_PUBLICADO));
  // TEMPORAL: sin API todavía. El tema guardado en /app/ajustes viaja en una cookie por navegador.
  const tema = resolverTema(leerAjustesDemo(cookies.get(COOKIE_AJUSTES)));
  return { negocio: getNegocio(params.slug, url, publicado), tema };
};
