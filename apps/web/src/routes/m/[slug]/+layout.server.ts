import { error } from "@sveltejs/kit";
import { COOKIE_PUBLICADO, getNegocio, publicadoPara, tema } from "#lib/server/demo.js";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ params, url, cookies }) => {
  const publicado = publicadoPara(params.slug, cookies.get(COOKIE_PUBLICADO));
  const negocio = getNegocio(params.slug, url, publicado);
  if (!negocio) error(404, "Este menú no existe o ya no está publicado.");
  return { negocio, tema };
};
