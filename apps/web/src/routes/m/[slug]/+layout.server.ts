import { COOKIE_PUBLICADO, getNegocio, publicadoPara, tema } from "#lib/server/demo.js";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ params, url, cookies }) => {
  const publicado = publicadoPara(params.slug, cookies.get(COOKIE_PUBLICADO));
  return { negocio: getNegocio(params.slug, url, publicado), tema };
};
