import {
  COOKIE_AVANCE,
  COOKIE_PEDIDOS,
  contarNuevos,
  getNegocioPanel,
  leerAvanceDemo,
  leerPedidosCreados,
} from "#lib/server/demo.js";
import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

// DESIGN.md §6.4 / AGENTS.md §6.4: el panel nunca se cachea.
export const load: LayoutServerLoad = ({ url, cookies, locals, setHeaders, depends }) => {
  if (!locals.session) redirect(303, "/entrar");
  setHeaders({ "cache-control": "no-store" });
  depends("app:pedidos");
  // TEMPORAL: `locals.session` es una sesión simulada (hooks.server.ts).
  return {
    negocio: getNegocioPanel(url),
    nuevos: contarNuevos(
      leerAvanceDemo(cookies.get(COOKIE_AVANCE)),
      leerPedidosCreados(cookies.get(COOKIE_PEDIDOS)),
    ),
  };
};
