
import { getPedido, tema } from "#lib/server/demo.js";
import { formatMoney } from "#lib/money.js";
import { COOKIE_PEDIDOS, getPedido, leerPedidosCreados, tema } from "#lib/server/demo.js";
import type { PageServerLoad } from "./$types";

type Pedido = ReturnType<typeof getPedido>;

// Enlace wa.me con el resumen del pedido. Solo es un enlace: no se envía nada
// hasta que el comensal lo abre y decide enviar el mensaje en WhatsApp.
// Devuelve `null` si el negocio no tiene un número utilizable (lada + 10 dígitos en MX).
function enlaceWhatsApp(pedido: Pedido, seguimiento: string): string | null {
  const numero = pedido.negocio.telefono.replace(/\D/g, "");
  if (numero.length < 11 || numero.length > 15) return null;
  const entrega =
    pedido.modalidad === "mesa"
      ? `Mesa ${pedido.mesa}`
      : pedido.modalidad === "domicilio"
        ? "A domicilio"
        : "Para recoger";
  const texto = [
    `Hola ${pedido.negocio.nombre}, hice el pedido #${pedido.codigo} a nombre de ${pedido.cliente}.`,
    ...pedido.lineas.map((l) => `${l.cantidad}× ${l.nombre}`),
    `Total: ${formatMoney(pedido.totalCents)} MXN · ${entrega}`,
    `Seguimiento: ${seguimiento}`,
  ].join("\n");
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

// DESIGN.md §6.4: el seguimiento nunca se cachea.
export const load: PageServerLoad = ({ params, url, cookies, setHeaders, depends }) => {
  setHeaders({ "cache-control": "no-store" });
  depends("app:pedido");
  const pedido = getPedido(params.token, url);
  // TEMPORAL: sin API todavía. El resumen sale del mismo pedido simulado que se muestra.
  return { pedido, tema, whatsappHref: enlaceWhatsApp(pedido, `${url.origin}${url.pathname}`) };
  const creados = leerPedidosCreados(cookies.get(COOKIE_PEDIDOS));
  return { pedido: getPedido(params.token, url, creados), tema };

};
