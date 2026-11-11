import { COOKIE_PEDIDOS, getPedido, leerPedidosCreados, tema } from "#lib/server/demo.js";
import type { PageServerLoad } from "./$types";

// DESIGN.md §6.4: el seguimiento nunca se cachea.
export const load: PageServerLoad = ({ params, url, cookies, setHeaders, depends }) => {
  setHeaders({ "cache-control": "no-store" });
  depends("app:pedido");
  const creados = leerPedidosCreados(cookies.get(COOKIE_PEDIDOS));
  return { pedido: getPedido(params.token, url, creados), tema };
};
