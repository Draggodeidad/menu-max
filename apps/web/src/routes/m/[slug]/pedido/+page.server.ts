import { error, fail, redirect } from "@sveltejs/kit";
import {
  COOKIE_AJUSTES,
  COOKIE_PEDIDOS,
  COOKIE_PUBLICADO,
  crearPedido,
  getEntrega,
  getNegocio,
  leerAjustesDemo,
  leerPedidosCreados,
  modalidadesActivas,
  publicadoPara,
  serializarPedidosCreados,
  simulaError,
  validarLineasPedido,
} from "#lib/server/demo.js";
import type { Actions, PageServerLoad } from "./$types";

// Clave de idempotencia del envío (DESIGN.md §7.2-I), generada en `load`.
export const load: PageServerLoad = ({ url, setHeaders, params, cookies }) => {
  setHeaders({ "cache-control": "no-store" });
  const publicado = publicadoPara(params.slug, cookies.get(COOKIE_PUBLICADO));
  const { servicio } = leerAjustesDemo(cookies.get(COOKIE_AJUSTES));
  return {
    mesa: url.searchParams.get("mesa"),
    // El cliente solo muestra lo que el servidor habilita; la action vuelve a validarlo.
    modalidades: modalidadesActivas(servicio, publicado),
    idempotencyKey: crypto.randomUUID(),
    entrega: getEntrega(), // TEMPORAL: sin API todavía
  };
};

type Campo = "nombre" | "telefono" | "direccion" | "notas";

export const actions: Actions = {
  enviar: async ({ request, url, params, cookies }) => {
    const publicado = publicadoPara(params.slug, cookies.get(COOKIE_PUBLICADO));
    if (!getNegocio(params.slug, url, publicado)) error(404, "Este menú no existe.");
    const form = await request.formData();
    const ids = form.getAll("id").map(String);
    const opciones = form.getAll("opcion").map(String);
    const cantidades = form.getAll("cantidad").map(Number);

    const valido =
      ids.length > 0 &&
      ids.length === cantidades.length &&
      cantidades.every((n) => Number.isInteger(n) && n >= 1 && n <= 99);
    if (!valido) {
      return fail(400, {
        error: "Tu pedido está vacío. Agrega un producto para continuar.",
      });
    }

    const texto = (name: string) => String(form.get(name) ?? "").trim();
    const mesa = url.searchParams.get("mesa");
    const pedida = texto("modalidad");
    // TEMPORAL: sin API todavía. Las modalidades y horarios vienen de los ajustes guardados.
    const { servicio } = leerAjustesDemo(cookies.get(COOKIE_AJUSTES));
    const activas = modalidadesActivas(
      servicio,
      publicadoPara(params.slug, cookies.get(COOKIE_PUBLICADO)),
    );
    const modalidad = mesa
      ? "mesa"
      : pedida === "domicilio" || pedida === "recoger"
        ? pedida
        : (activas.find((m) => m !== "mesa") ?? "recoger");
    if (!activas.includes(modalidad)) {
      return fail(409, {
        error:
          modalidad === "mesa"
            ? "Este negocio ya no recibe pedidos en mesa. Pide en mostrador."
            : "Esta modalidad no está disponible. Elige otra para continuar.",
      });
    }
    const values = {
      modalidad,
      nombre: texto("nombre"),
      telefono: texto("telefono"),
      direccion: texto("direccion"),
      notas: texto("notas"),
    };

    const fieldErrors: Partial<Record<Campo, string>> = {};
    if (values.nombre.length < 2) {
      fieldErrors.nombre = "Escribe tu nombre para que el negocio sepa a quién entregar.";
    }
    if (values.telefono.replace(/\D/g, "").length !== 10) {
      fieldErrors.telefono = "Escribe tu teléfono de 10 dígitos para confirmar tu pedido.";
    }
    if (modalidad === "domicilio" && values.direccion.length < 5) {
      fieldErrors.direccion = "Escribe calle, número y colonia para el domicilio.";
    }
    if (values.notas.length > 200) {
      fieldErrors.notas = "Acorta las notas a 200 caracteres.";
    }
    if (Object.keys(fieldErrors).length > 0) {
      return fail(400, { fieldErrors, values });
    }

    // TEMPORAL: sin API todavía. El cliente solo manda ids y cantidades; la API
    // recalculará precios, total y disponibilidad, y validará el horario.
    // Las banderas de desarrollo se leen del referer porque la action no conserva la query.
    const origen = new URL(request.headers.get("referer") ?? url);

    const negocio = getNegocio(params.slug, origen, publicado, servicio);

    if (!negocio) {
      error(404, "Este menú no existe.");
    }

    if (!negocio.abierto) {
      return fail(409, { error: `Estamos cerrados. Abrimos a las ${negocio.abre}.`, values });
    }
    if (simulaError(origen)) {
      return fail(409, {
        error: "Este producto ya no está disponible. Quítalo para continuar.",
        values,
      });
    }

    const lineas = ids.map((id, i) => ({
      id,
      cantidad: cantidades[i],
      opcion: opciones[i] ?? "",
    }));
    const errorProductos = await validarLineasPedido(lineas, origen);
    if (errorProductos) return fail(409, { error: errorProductos, values });

    // TEMPORAL: el token de seguimiento lo entregará la API; aquí es la clave de idempotencia.
    const clave = String(form.get("idempotencyKey") ?? "");
    const token = /^[\w-]{8,64}$/.test(clave) ? clave : crypto.randomUUID();
    // TEMPORAL: sin API todavía. El pedido se guarda en una cookie por navegador; los importes
    // no se guardan: se recalculan desde el catálogo del servidor.
    const pedidos = crearPedido(leerPedidosCreados(cookies.get(COOKIE_PEDIDOS)), {
      token,
      modalidad,
      mesa: mesa ?? undefined,
      cliente: { nombre: values.nombre, telefono: values.telefono },
      direccion: modalidad === "domicilio" ? values.direccion : undefined,
      nota: values.notas || undefined,
      lineas: lineas.map(({ id, cantidad }) => ({ id, cantidad })),
    });
    cookies.set(COOKIE_PEDIDOS, serializarPedidosCreados(pedidos), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 8,
    });
    redirect(303, `/pedido/${token}`);
  },
};
