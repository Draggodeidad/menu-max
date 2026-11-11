import { fail } from "@sveltejs/kit";
import type { Cookies } from "@sveltejs/kit";
import { formatMoney, parseMoneyToCents } from "#lib/money.js";
import {
  CatalogoError,
  COOKIE_CATALOGO,
  LIMITE_COOKIE_CATALOGO,
  aplicarCambiosCatalogo,
  getCatalogo,
  getResumenCatalogo,
  leerCambiosCatalogo,
  type CambiosCatalogo,
  type ResultadoCatalogo,
} from "#lib/server/demo.js";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, cookies }) => {
  const cambios = leerCambiosCatalogo(cookies.get(COOKIE_CATALOGO));
  try {
    const categorias = await getCatalogo(url, cambios);
    return { categorias, resumen: getResumenCatalogo(categorias), error: false };
  } catch (e) {
    if (!(e instanceof CatalogoError)) throw e;
    return { categorias: [], resumen: getResumenCatalogo([]), error: true };
  }
};

const LIMITE_DEMO = "Llegaste al límite de la demo. Elimina algo del menú para seguir agregando.";
const NO_ENCONTRADO =
  "Este producto ya no está en tu menú. Recarga la página para ver los cambios.";
const NOMBRE_VACIO = "Escribe un nombre de al menos 2 letras.";

// TEMPORAL: sin API todavía. Las ediciones simuladas se guardan en una cookie por usuario.
function guardar(cookies: Cookies, cambios: CambiosCatalogo): boolean {
  const valor = JSON.stringify(cambios);
  if (valor.length > LIMITE_COOKIE_CATALOGO) return false;
  cookies.set(COOKIE_CATALOGO, valor, {
    path: "/app",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 8,
  });
  return true;
}

const nuevoId = () => `n${crypto.randomUUID().slice(0, 8)}`;
const campo = (datos: FormData, nombre: string) => String(datos.get(nombre) ?? "").trim();
const nombreValido = (nombre: string) => nombre.length >= 2 && nombre.length <= 60;

function leer(cookies: Cookies) {
  const cambios = leerCambiosCatalogo(cookies.get(COOKIE_CATALOGO));
  return { cambios, categorias: aplicarCambiosCatalogo(cambios) };
}

const error = (status: number, accion: ResultadoCatalogo["accion"], id: string, mensaje: string) =>
  fail(status, { ok: false, accion, id, error: mensaje } satisfies ResultadoCatalogo);

export const actions = {
  // El cliente solo manda id, precio y disponibilidad; el servidor valida (AGENTS.md §0.1).
  guardar: async ({ request, cookies }) => {
    const datos = await request.formData();
    const id = campo(datos, "id");
    const { cambios, categorias } = leer(cookies);
    const producto = categorias.flatMap((c) => c.productos).find((p) => p.id === id);
    if (!producto) return error(404, "guardar", id, NO_ENCONTRADO);

    const precio = campo(datos, "precio");
    const precioCents = parseMoneyToCents(precio);
    if (precioCents === null) {
      return fail(400, {
        ok: false,
        accion: "guardar",
        id,
        fieldErrors: { precio: "Escribe un precio mayor a $0. Ejemplo: 22.00" },
        values: { precio },
      } satisfies ResultadoCatalogo);
    }

    const disponible = datos.get("disponible") === "on";
    cambios.productos[id] = { ...cambios.productos[id], precioCents, disponible };
    if (!guardar(cookies, cambios)) return error(400, "guardar", id, LIMITE_DEMO);
    return {
      ok: true,
      accion: "guardar",
      id,
      mensaje: `${producto.nombre}: ${formatMoney(precioCents)}, ${disponible ? "disponible" : "agotado"}. Guardado.`,
    } satisfies ResultadoCatalogo;
  },

  eliminar: async ({ request, cookies }) => {
    const datos = await request.formData();
    const id = campo(datos, "id");
    const { cambios, categorias } = leer(cookies);
    const producto = categorias.flatMap((c) => c.productos).find((p) => p.id === id);
    if (!producto) return error(404, "eliminar", id, NO_ENCONTRADO);

    cambios.productos[id] = { ...cambios.productos[id], eliminado: true };
    if (!guardar(cookies, cambios)) return error(400, "eliminar", id, LIMITE_DEMO);
    return {
      ok: true,
      accion: "eliminar",
      id,
      mensaje: `Producto «${producto.nombre}» eliminado.`,
    } satisfies ResultadoCatalogo;
  },

  agregarProducto: async ({ request, cookies }) => {
    const datos = await request.formData();
    const id = campo(datos, "categoriaId");
    const { cambios, categorias } = leer(cookies);
    const categoria = categorias.find((c) => c.id === id);
    if (!categoria) return error(404, "agregar-producto", id, "Esta categoría ya no existe.");

    const nombre = campo(datos, "nombre");
    const precio = campo(datos, "precio");
    const precioCents = parseMoneyToCents(precio);
    const fieldErrors: NonNullable<ResultadoCatalogo["fieldErrors"]> = {};
    if (!nombreValido(nombre)) fieldErrors.nombre = NOMBRE_VACIO;
    if (precioCents === null) fieldErrors.precio = "Escribe un precio mayor a $0. Ejemplo: 22.00";
    if (precioCents === null || fieldErrors.nombre) {
      return fail(400, {
        ok: false,
        accion: "agregar-producto",
        id,
        fieldErrors,
        values: { nombre, precio },
      } satisfies ResultadoCatalogo);
    }

    cambios.nuevosProductos.push({ id: nuevoId(), categoriaId: id, nombre, precioCents });
    if (!guardar(cookies, cambios)) return error(400, "agregar-producto", id, LIMITE_DEMO);
    return {
      ok: true,
      accion: "agregar-producto",
      id,
      mensaje: `Producto «${nombre}» agregado a ${categoria.nombre}.`,
    } satisfies ResultadoCatalogo;
  },

  agregarCategoria: async ({ request, cookies }) => {
    const datos = await request.formData();
    const nombre = campo(datos, "nombre");
    const id = "nueva-categoria";
    if (!nombreValido(nombre)) {
      return fail(400, {
        ok: false,
        accion: "agregar-categoria",
        id,
        fieldErrors: { nombre: NOMBRE_VACIO },
        values: { nombre },
      } satisfies ResultadoCatalogo);
    }
    const { cambios, categorias } = leer(cookies);
    if (categorias.some((c) => c.nombre.toLowerCase() === nombre.toLowerCase())) {
      return fail(400, {
        ok: false,
        accion: "agregar-categoria",
        id,
        fieldErrors: { nombre: "Ya tienes una categoría con ese nombre. Usa otro." },
        values: { nombre },
      } satisfies ResultadoCatalogo);
    }

    cambios.nuevasCategorias.push({ id: nuevoId(), nombre });
    if (!guardar(cookies, cambios)) return error(400, "agregar-categoria", id, LIMITE_DEMO);
    return {
      ok: true,
      accion: "agregar-categoria",
      id,
      mensaje: `Categoría «${nombre}» creada.`,
    } satisfies ResultadoCatalogo;
  },

  eliminarCategoria: async ({ request, cookies }) => {
    const datos = await request.formData();
    const id = campo(datos, "id");
    const { cambios, categorias } = leer(cookies);
    const categoria = categorias.find((c) => c.id === id);
    if (!categoria) return error(404, "eliminar-categoria", id, "Esta categoría ya no existe.");

    cambios.categoriasEliminadas.push(id);
    if (!guardar(cookies, cambios)) return error(400, "eliminar-categoria", id, LIMITE_DEMO);
    return {
      ok: true,
      accion: "eliminar-categoria",
      id,
      mensaje: `Categoría «${categoria.nombre}» eliminada.`,
    } satisfies ResultadoCatalogo;
  },

  moverCategoria: async ({ request, cookies }) => {
    const datos = await request.formData();
    const id = campo(datos, "id");
    const direccion = campo(datos, "direccion");
    const { cambios, categorias } = leer(cookies);
    const ids = categorias.map((c) => c.id);
    const desde = ids.indexOf(id);
    const hasta = direccion === "arriba" ? desde - 1 : direccion === "abajo" ? desde + 1 : -1;
    if (desde === -1 || hasta < 0 || hasta >= ids.length) {
      return error(400, "mover-categoria", id, "No se puede mover esa categoría en ese sentido.");
    }

    const movida = categorias[desde];
    const vecina = categorias[hasta];
    if (!movida || !vecina)
      return error(400, "mover-categoria", id, "No se puede mover esa categoría.");
    ids[desde] = vecina.id;
    ids[hasta] = movida.id;
    cambios.orden = ids;
    if (!guardar(cookies, cambios)) return error(400, "mover-categoria", id, LIMITE_DEMO);
    return {
      ok: true,
      accion: "mover-categoria",
      id,
      mensaje: `Categoría «${movida.nombre}» movida ${direccion === "arriba" ? "arriba" : "abajo"}.`,
    } satisfies ResultadoCatalogo;
  },

  agregarVariante: async ({ request, cookies }) => {
    const datos = await request.formData();
    const id = campo(datos, "productoId");
    const { cambios, categorias } = leer(cookies);
    const producto = categorias.flatMap((c) => c.productos).find((p) => p.id === id);
    if (!producto) return error(404, "agregar-variante", id, NO_ENCONTRADO);

    const nombre = campo(datos, "nombre");
    const extra = campo(datos, "extra") || "0";
    const extraCents = parseMoneyToCents(extra, { allowZero: true });
    const fieldErrors: NonNullable<ResultadoCatalogo["fieldErrors"]> = {};
    if (!nombreValido(nombre)) fieldErrors.nombre = NOMBRE_VACIO;
    if (extraCents === null) fieldErrors.extra = "Escribe el costo extra. Usa 0 si no cuesta más.";
    if (extraCents === null || fieldErrors.nombre) {
      return fail(400, {
        ok: false,
        accion: "agregar-variante",
        id,
        fieldErrors,
        values: { nombre, extra },
      } satisfies ResultadoCatalogo);
    }

    cambios.nuevasVariantes.push({
      id: nuevoId(),
      productoId: id,
      nombre,
      extraCents,
      activa: true,
    });
    if (!guardar(cookies, cambios)) return error(400, "agregar-variante", id, LIMITE_DEMO);
    return {
      ok: true,
      accion: "agregar-variante",
      id,
      mensaje: `Opción «${nombre}» agregada a ${producto.nombre}.`,
    } satisfies ResultadoCatalogo;
  },

  alternarVariante: async ({ request, cookies }) => {
    const datos = await request.formData();
    const id = campo(datos, "productoId");
    const varianteId = campo(datos, "varianteId");
    const { cambios, categorias } = leer(cookies);
    const producto = categorias.flatMap((c) => c.productos).find((p) => p.id === id);
    const variante = producto?.variantes.find((v) => v.id === varianteId);
    if (!producto || !variante) return error(404, "alternar-variante", id, NO_ENCONTRADO);

    const activa = datos.get("activa") === "on";
    cambios.variantes[`${id}:${varianteId}`] = activa;
    if (!guardar(cookies, cambios)) return error(400, "alternar-variante", id, LIMITE_DEMO);
    return {
      ok: true,
      accion: "alternar-variante",
      id,
      mensaje: `Opción «${variante.nombre}» ${activa ? "activada" : "desactivada"}.`,
    } satisfies ResultadoCatalogo;
  },

  // TEMPORAL: sin API todavía. No se guarda el archivo; solo se valida y se simula la foto.
  subirFoto: async ({ request, cookies }) => {
    const datos = await request.formData();
    const id = campo(datos, "id");
    const foto = datos.get("foto");
    const { cambios, categorias } = leer(cookies);
    const producto = categorias.flatMap((c) => c.productos).find((p) => p.id === id);
    if (!producto) return error(404, "subir-foto", id, NO_ENCONTRADO);
    if (!(foto instanceof File) || foto.size === 0) {
      return error(400, "subir-foto", id, "Elige una foto para subir.");
    }
    if (!foto.type.startsWith("image/") || foto.size > 5 * 1024 * 1024) {
      return error(400, "subir-foto", id, "Sube una imagen de máximo 5 MB.");
    }

    cambios.productos[id] = { ...cambios.productos[id], conFoto: true };
    if (!guardar(cookies, cambios)) return error(400, "subir-foto", id, LIMITE_DEMO);
    return {
      ok: true,
      accion: "subir-foto",
      id,
      mensaje: `Foto de «${producto.nombre}» guardada.`,
    } satisfies ResultadoCatalogo;
  },
} satisfies Actions;
