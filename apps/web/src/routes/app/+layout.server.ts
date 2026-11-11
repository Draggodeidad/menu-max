import {
  COOKIE_AVANCE,
  COOKIE_PEDIDOS,
  contarNuevos,
  getNegocioPanel,
  leerAvanceDemo,
  leerPedidosCreados,
} from "#lib/server/demo.js";
import type { LayoutServerLoad } from "./$types";

// DESIGN.md §6.4 / AGENTS.md §6.4: el panel nunca se cachea.
export const load: LayoutServerLoad = ({ url, cookies, setHeaders, depends }) => {
  setHeaders({ "cache-control": "no-store" });
  depends("app:pedidos");
  // TEMPORAL: sesión simulada. Se sustituirá por `locals.session` cuando exista el login.
  return {
    negocio: getNegocioPanel(url),
    nuevos: contarNuevos(
      leerAvanceDemo(cookies.get(COOKIE_AVANCE)),
      leerPedidosCreados(cookies.get(COOKIE_PEDIDOS)),
    ),
  };
};
