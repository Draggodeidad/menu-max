import { fail } from "@sveltejs/kit";
import type { Cookies } from "@sveltejs/kit";
import {
  COOKIE_AVANCE,
  PanelError,
  buscarPedido,
  getPanelPedidos,
  getResumenPanel,
  leerAvanceDemo,
  siguienteEstado,
  type AvanceDemo,
} from "#lib/server/demo.js";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, cookies, depends }) => {
  depends("app:pedidos");
  const avance = leerAvanceDemo(cookies.get(COOKIE_AVANCE));
  try {
    const pedidos = await getPanelPedidos(url, avance);
    return { pedidos, resumen: getResumenPanel(pedidos), error: false };
  } catch (e) {
    if (!(e instanceof PanelError)) throw e;
    return { pedidos: [], resumen: getResumenPanel([]), error: true };
  }
};

// TEMPORAL: sin API todavía. El avance simulado se guarda en una cookie por usuario.
function guardarAvance(cookies: Cookies, avance: AvanceDemo) {
  cookies.set(COOKIE_AVANCE, JSON.stringify(avance), {
    path: "/app",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 8,
  });
}

const MENSAJE_ESTADO = {
  accepted: "aceptado",
  preparing: "en preparación",
  ready: "listo",
  out_for_delivery: "enviado a domicilio",
  delivered: "entregado",
  pending: "por aceptar",
  rejected: "rechazado",
} as const;

const NO_ENCONTRADO = "Este pedido ya no está en el panel. Actualiza la lista para ver su estado.";

export const actions = {
  // El cliente solo manda el id: la transición la decide el servidor (AGENTS.md §0.1).
  avanzar: async ({ request, cookies }) => {
    const datos = await request.formData();
    const id = String(datos.get("id") ?? "");
    const avance = leerAvanceDemo(cookies.get(COOKIE_AVANCE));
    const pedido = buscarPedido(id, avance);
    if (!pedido) return fail(404, { ok: false, id, error: NO_ENCONTRADO });

    const siguiente = siguienteEstado(pedido.estado, pedido.modalidad);
    guardarAvance(cookies, { ...avance, [id]: siguiente });
    return { ok: true, id, mensaje: `Pedido #${pedido.codigo} ${MENSAJE_ESTADO[siguiente]}.` };
  },

  rechazar: async ({ request, cookies }) => {
    const datos = await request.formData();
    const id = String(datos.get("id") ?? "");
    const motivo = String(datos.get("motivo") ?? "").trim();
    const avance = leerAvanceDemo(cookies.get(COOKIE_AVANCE));
    const pedido = buscarPedido(id, avance);
    if (!pedido) return fail(404, { ok: false, id, error: NO_ENCONTRADO });
    if (pedido.estado !== "pending") {
      return fail(409, { ok: false, id, error: "Solo puedes rechazar pedidos por aceptar." });
    }
    if (motivo.length < 3) {
      return fail(400, {
        ok: false,
        id,
        fieldErrors: { motivo: "Escribe el motivo del rechazo para avisar al cliente." },
        values: { motivo },
      });
    }

    guardarAvance(cookies, { ...avance, [id]: "rejected" });
    return { ok: true, id, mensaje: `Pedido #${pedido.codigo} rechazado.` };
  },
} satisfies Actions;
