import { fail } from "@sveltejs/kit";
import type { Cookies } from "@sveltejs/kit";
import QRCode from "qrcode";
import {
  COOKIE_AJUSTES,
  COOKIE_CATALOGO,
  FUENTES_TEMA,
  MAX_MESAS,
  PRESETS_TEMA,
  PanelError,
  ROLES_EQUIPO,
  contraste,
  getCategorias,
  getAjustes,
  leerAjustesDemo,
  leerCambiosCatalogo,
  normalizaHex,
  type AjustesDemo,
  type PresetTema,
  type RolEquipo,
} from "#lib/server/demo.js";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, cookies, parent, depends }) => {
  depends("app:ajustes");
  const { negocio } = await parent();
  try {
    const ajustes = await getAjustes(url, cookies.get(COOKIE_AJUSTES));
    const categorias = await getCategorias(url, leerCambiosCatalogo(cookies.get(COOKIE_CATALOGO)));
    // Un QR por mesa: el enlace lleva `?mesa=n` (DESIGN.md §7.2 H).
    const mesas = await Promise.all(
      Array.from({ length: ajustes.mesas }, async (_, i) => {
        const n = i + 1;
        const enlace = new URL(`/m/${negocio.slug}?mesa=${n}`, url.origin).href;
        const svg = await QRCode.toString(enlace, { type: "svg", margin: 1 });
        return {
          n,
          enlace: `/m/${negocio.slug}?mesa=${n}`,
          src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        };
      }),
    );
    return {
      error: false as const,
      ajustes,
      categorias,
      mesas,
      presets: PRESETS_TEMA,
      fuentes: FUENTES_TEMA,
      roles: ROLES_EQUIPO,
      maxMesas: MAX_MESAS,
    };
  } catch (e) {
    if (!(e instanceof PanelError)) throw e;
    return { error: true as const };
  }
};

// TEMPORAL: sin API todavía. Los cambios se guardan en una cookie por usuario.
function guardar(cookies: Cookies, ajustes: AjustesDemo) {
  cookies.set(COOKIE_AJUSTES, JSON.stringify(ajustes), {
    path: "/app",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 8,
  });
}

type Errores = Record<string, string>;
type Valores = Record<string, string>;

// Forma única del rechazo: los componentes leen `fieldErrors` y `values` sin importar la acción.
const rechazo = (status: number, seccion: string, fieldErrors: Errores, values: Valores = {}) =>
  fail(status, { seccion, ok: false as const, fieldErrors, values });
const texto = (datos: FormData, campo: string) => String(datos.get(campo) ?? "").trim();
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const actions = {
  tema: async ({ request, cookies }) => {
    const datos = await request.formData();
    const values = {
      preset: texto(datos, "preset"),
      primario: texto(datos, "primario"),
      fuente: texto(datos, "fuente"),
    };
    const errores: Errores = {};
    const preset = PRESETS_TEMA.find((p) => p.id === values.preset);
    if (!preset) errores.preset = "Elige uno de los presets disponibles.";
    if (!FUENTES_TEMA.some((f) => f.id === values.fuente)) {
      errores.fuente = "Elige uno de los estilos tipográficos disponibles.";
    }
    const primario = normalizaHex(values.primario);
    if (!primario) {
      errores.primario = "Escribe un color en formato HEX, por ejemplo #1F5C45.";
    } else if (preset && contraste(primario, preset.bg) < 4.5) {
      const masOscuro = contraste("#000000", preset.bg) < contraste("#FFFFFF", preset.bg);
      errores.primario = `Este color no se lee bien sobre el fondo del menú. Elige uno ${masOscuro ? "más claro" : "más oscuro"}.`;
    }
    if (Object.keys(errores).length > 0 || !primario) {
      return rechazo(400, "tema", errores, values);
    }

    const ajustes = leerAjustesDemo(cookies.get(COOKIE_AJUSTES));
    ajustes.tema = {
      preset: values.preset as PresetTema,
      primario,
      fuente: values.fuente as AjustesDemo["tema"]["fuente"],
    };
    guardar(cookies, ajustes);
    return { seccion: "tema", ok: true, mensaje: "Guardado" };
  },

  servicio: async ({ request, cookies }) => {
    const datos = await request.formData();
    const canales = {
      mesa: datos.has("mesa"),
      recoger: datos.has("recoger"),
      domicilio: datos.has("domicilio"),
    };
    const values: Record<string, string> = {
      abre: texto(datos, "abre"),
      cierra: texto(datos, "cierra"),
      tiempo: texto(datos, "tiempo"),
      mesa: canales.mesa ? "on" : "",
      recoger: canales.recoger ? "on" : "",
      domicilio: canales.domicilio ? "on" : "",
    };
    const errores: Errores = {};
    if (!canales.mesa && !canales.recoger && !canales.domicilio) {
      errores.canales = "Activa al menos una modalidad para recibir pedidos.";
    }
    if (!HORA.test(values.abre ?? "")) errores.abre = "Elige la hora de apertura.";
    if (!HORA.test(values.cierra ?? "")) errores.cierra = "Elige la hora de cierre.";
    if (!errores.abre && !errores.cierra && values.abre === values.cierra) {
      errores.cierra = "La hora de cierre no puede ser igual a la de apertura.";
    }
    const tiempo = Number(values.tiempo);
    if (!Number.isInteger(tiempo) || tiempo < 1 || tiempo > 180) {
      errores.tiempo = "Escribe un tiempo entre 1 y 180 minutos.";
    }
    if (Object.keys(errores).length > 0) {
      return rechazo(400, "servicio", errores, values);
    }

    const ajustes = leerAjustesDemo(cookies.get(COOKIE_AJUSTES));
    ajustes.servicio = {
      ...canales,
      abre: values.abre ?? "",
      cierra: values.cierra ?? "",
      tiempoMin: tiempo,
    };
    guardar(cookies, ajustes);
    return { seccion: "servicio", ok: true, mensaje: "Guardado" };
  },

  zonas: async ({ request, cookies }) => {
    const datos = await request.formData();
    const ids = datos.getAll("id").map(String);
    const nombres = datos.getAll("nombre").map((v) => String(v).trim());
    const costos = datos.getAll("costo").map((v) => String(v).trim());
    const errores: Errores = {};
    if (ids.length > 20) errores.general = "Puedes tener hasta 20 zonas de entrega.";
    const zonas: AjustesDemo["zonas"] = [];
    ids.forEach((id, i) => {
      const nombre = nombres[i] ?? "";
      const costo = Number((costos[i] ?? "").replace(",", "."));
      if (nombre.length < 2) errores[`nombre-${i}`] = "Escribe el nombre de la zona.";
      if (!costos[i] || !Number.isFinite(costo) || costo < 0 || costo > 9999) {
        errores[`costo-${i}`] = "Escribe un costo entre $0 y $9,999.";
      }
      zonas.push({ id, nombre, costoCents: Math.round(costo * 100) });
    });
    if (Object.keys(errores).length > 0) {
      return rechazo(400, "zonas", errores, {});
    }

    const ajustes = leerAjustesDemo(cookies.get(COOKIE_AJUSTES));
    ajustes.zonas = zonas;
    guardar(cookies, ajustes);
    return { seccion: "zonas", ok: true, mensaje: "Guardado" };
  },

  invitar: async ({ request, cookies }) => {
    const datos = await request.formData();
    const values = { correo: texto(datos, "correo").toLowerCase(), rol: texto(datos, "rol") };
    const ajustes = leerAjustesDemo(cookies.get(COOKIE_AJUSTES));
    const errores: Errores = {};
    if (!CORREO.test(values.correo)) {
      errores.correo = "Escribe un correo válido, por ejemplo cocina@taqueria.com.";
    } else if (ajustes.equipo.some((m) => m.correo === values.correo)) {
      errores.correo = "Ese correo ya tiene acceso al panel.";
    }
    if (!ROLES_EQUIPO.some((r) => r.id === values.rol)) errores.rol = "Elige un rol.";
    if (Object.keys(errores).length > 0) {
      return rechazo(400, "equipo", errores, values);
    }

    const [usuario = values.correo] = values.correo.split("@");
    ajustes.equipo.push({
      id: `u${Date.now().toString(36)}`,
      nombre: usuario,
      correo: values.correo,
      rol: values.rol as RolEquipo,
      pendiente: true,
    });
    guardar(cookies, ajustes);
    return { seccion: "equipo", ok: true, mensaje: `Invitación enviada a ${values.correo}.` };
  },

  rol: async ({ request, cookies }) => {
    const datos = await request.formData();
    const id = texto(datos, "id");
    const rol = texto(datos, "rol");
    const ajustes = leerAjustesDemo(cookies.get(COOKIE_AJUSTES));
    const miembro = ajustes.equipo.find((m) => m.id === id);
    if (!miembro || miembro.rol === "dueno") {
      return rechazo(
        404,
        "equipo",
        { general: "Esta persona ya no está en tu equipo. Actualiza la página." },
        {},
      );
    }
    if (!ROLES_EQUIPO.some((r) => r.id === rol)) {
      return rechazo(400, "equipo", { general: "Elige un rol de la lista." }, {});
    }
    miembro.rol = rol as RolEquipo;
    guardar(cookies, ajustes);
    return { seccion: "equipo", ok: true, mensaje: `Rol de ${miembro.nombre} actualizado.` };
  },

  quitar: async ({ request, cookies }) => {
    const datos = await request.formData();
    const id = texto(datos, "id");
    const ajustes = leerAjustesDemo(cookies.get(COOKIE_AJUSTES));
    const miembro = ajustes.equipo.find((m) => m.id === id);
    if (!miembro || miembro.rol === "dueno") {
      return rechazo(
        404,
        "equipo",
        { general: "Esta persona ya no está en tu equipo. Actualiza la página." },
        {},
      );
    }
    ajustes.equipo = ajustes.equipo.filter((m) => m.id !== id);
    guardar(cookies, ajustes);
    return { seccion: "equipo", ok: true, mensaje: `${miembro.nombre} ya no tiene acceso.` };
  },

  mesas: async ({ request, cookies }) => {
    const datos = await request.formData();
    const valor = texto(datos, "mesas");
    const mesas = Number(valor);
    if (!Number.isInteger(mesas) || mesas < 1 || mesas > MAX_MESAS) {
      return rechazo(
        400,
        "qr",
        { mesas: `Escribe un número de mesas entre 1 y ${MAX_MESAS}.` },
        { mesas: valor },
      );
    }
    const ajustes = leerAjustesDemo(cookies.get(COOKIE_AJUSTES));
    ajustes.mesas = mesas;
    guardar(cookies, ajustes);
    return { seccion: "qr", ok: true, mensaje: "Guardado" };
  },
} satisfies Actions;
