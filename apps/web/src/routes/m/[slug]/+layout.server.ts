import { error } from "@sveltejs/kit";
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

  // TEMPORAL: sin API todavía. Los ajustes viven en una cookie del navegador.
  const ajustes = leerAjustesDemo(cookies.get(COOKIE_AJUSTES));

  const tema = resolverTema(ajustes);
  const { servicio } = ajustes;

  const negocio = getNegocio(params.slug, url, publicado, servicio);

  if (!negocio) {
    error(404, "Este menú no existe o ya no está publicado.");
  }

  return {
    negocio,
    tema,
  };
};
