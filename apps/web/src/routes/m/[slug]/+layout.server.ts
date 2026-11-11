import {
  COOKIE_AJUSTES,
  COOKIE_PUBLICADO,
  getNegocio,
  leerAjustesDemo,
  publicadoPara,
  tema,
} from "#lib/server/demo.js";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ params, url, cookies }) => {
  const publicado = publicadoPara(params.slug, cookies.get(COOKIE_PUBLICADO));
  // TEMPORAL: sin API todavía. Los horarios guardados en ajustes viven en una cookie del navegador.
  const { servicio } = leerAjustesDemo(cookies.get(COOKIE_AJUSTES));
  return { negocio: getNegocio(params.slug, url, publicado, servicio), tema };
};
