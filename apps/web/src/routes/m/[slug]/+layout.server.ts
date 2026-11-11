import { getNegocio, tema } from "#lib/server/demo.js";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ params, url }) => {
  return { negocio: getNegocio(params.slug, url), tema };
};
