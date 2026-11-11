import QRCode from "qrcode";
import { COOKIE_PUBLICADO, leerPublicado, slugNegocioDemo } from "#lib/server/demo.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, cookies }) => {
  // TEMPORAL: el negocio publicado se sustituirá por los datos de la sesión.
  const publicado = leerPublicado(cookies.get(COOKIE_PUBLICADO));
  const enlace = new URL(`/m/${publicado?.slug ?? slugNegocioDemo}`, url.origin).href;
  const qr = QRCode.create(enlace, { errorCorrectionLevel: "M" });
  const svg = await QRCode.toString(enlace, { type: "svg", margin: 4 });

  return {
    enlace,
    qr: { size: qr.modules.size, modules: Array.from(qr.modules.data) },
    descarga: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  };
};
