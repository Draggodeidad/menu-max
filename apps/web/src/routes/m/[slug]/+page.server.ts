import { getCategorias } from "#lib/server/demo.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, setHeaders }) => {
  setHeaders({ "cache-control": "public, max-age=60, s-maxage=300" });
  return {
    mesa: url.searchParams.get("mesa"),
    categorias: await getCategorias(url),
  };
};
