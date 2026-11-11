import { getPedido, tema } from "#lib/server/demo.js";
import type { PageServerLoad } from "./$types";

// DESIGN.md §6.4: el seguimiento nunca se cachea.
export const load: PageServerLoad = ({ params, url, setHeaders, depends }) => {
  setHeaders({ "cache-control": "no-store" });
  depends("app:pedido");
  return { pedido: getPedido(params.token, url), tema };
};
