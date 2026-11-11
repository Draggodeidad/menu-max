// TEMPORAL: datos de ejemplo hasta que exista el contrato del menú público en
// `packages/contracts` y el cliente tipado `#lib/server/api.ts`. Borrar entonces.
import { dev } from "$app/env";
import { PLACEHOLDER_IMAGE } from "#lib/images.js";
import { formatMoney } from "#lib/money.js";

/** Banderas solo para desarrollo: ?abierto=false, ?vacio=1, ?lento=1 */
const flag = (url: URL, name: string, value: string) => dev && url.searchParams.get(name) === value;

// TEMPORAL: negocio único de la demo; panel, menú público y activación leen de aquí.
export const slugNegocioDemo = "tacos-el-guero";
const NOMBRE_NEGOCIO_DEMO = "Tacos El Güero";

export function getNegocio(
  slug: string,
  url: URL,
  publicado?: NegocioPublicado | null,
  servicio?: Pick<AjustesDemo["servicio"], "abre" | "cierra">,
) {
  return {
    slug,
    nombre: publicado?.nombre ?? NOMBRE_NEGOCIO_DEMO,
    // TEMPORAL: sin reloj para que las pruebas sean deterministas; solo la bandera cierra el negocio.
    abierto: !flag(url, "abierto", "false"),
    abre: servicio?.abre ?? AJUSTES_BASE.servicio.abre,
    cierra: servicio?.cierra ?? AJUSTES_BASE.servicio.cierra,
  };
}

/** Modalidades que el negocio acepta: las del menú publicado o las guardadas en ajustes. */
export function modalidadesActivas(
  servicio: AjustesDemo["servicio"],
  publicado?: NegocioPublicado | null,
): Modalidad[] {
  if (publicado) return MODALIDADES.filter((m) => publicado.modalidades.includes(m));
  return MODALIDADES.filter((m) => servicio[m]);
}

// TEMPORAL: menú publicado desde /crear. Vive en una cookie por navegador (nunca en el
// módulo, que en SSR se comparte entre usuarios). La API lo guardará con el negocio.
export type NegocioPublicado = {
  slug: string;
  nombre: string;
  whatsapp: string;
  modalidades: Modalidad[];
  productos: { id: string; nombre: string; precioCents: number }[];
};

// TEMPORAL: productos de ejemplo con los que arranca /crear (precios como texto de formulario).
export const PRODUCTOS_EJEMPLO_CREAR = [
  { nombre: "Pastor con piña", precio: "22.00" },
  { nombre: "Suadero confitado", precio: "24.00" },
  { nombre: "Agua de horchata (1L)", precio: "35.00" },
];

export const COOKIE_PUBLICADO = "demo_publicado";
/** Las cookies admiten ~4 kB; con este tope la demo avisa antes de que el navegador la descarte. */
export const LIMITE_COOKIE_PUBLICADO = 3500;
export const MAX_PRODUCTOS_PUBLICADO = 15;
export const MODALIDADES: Modalidad[] = ["mesa", "recoger", "domicilio"];

export const slugify = (nombre: string) =>
  nombre
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function leerPublicado(raw: string | undefined): NegocioPublicado | null {
  if (!raw) return null;
  try {
    const p: unknown = JSON.parse(raw);
    if (!esRegistro(p) || typeof p.slug !== "string" || typeof p.nombre !== "string") return null;
    if (typeof p.whatsapp !== "string" || !Array.isArray(p.modalidades)) return null;
    if (!Array.isArray(p.productos)) return null;
    return {
      slug: p.slug,
      nombre: p.nombre,
      whatsapp: p.whatsapp,
      modalidades: p.modalidades.filter((m): m is Modalidad => MODALIDADES.includes(m)),
      productos: p.productos.filter(
        (x): x is NegocioPublicado["productos"][number] =>
          esRegistro(x) &&
          typeof x.id === "string" &&
          typeof x.nombre === "string" &&
          typeof x.precioCents === "number",
      ),
    };
  } catch {
    return null;
  }
}

/** El negocio publicado solo existe para su propio slug; cualquier otro usa el mock base. */
export const publicadoPara = (slug: string, raw: string | undefined) => {
  const negocio = leerPublicado(raw);
  return negocio?.slug === slug ? negocio : null;
};

/** Categorías del menú público a partir del negocio publicado. */
export function categoriasPublicado(negocio: NegocioPublicado) {
  return [
    {
      id: "menu",
      nombre: "Menú principal",
      productos: negocio.productos.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        descripcion: "",
        precioCents: p.precioCents,
        imagen: PLACEHOLDER_IMAGE,
      })),
    },
  ];
}

// TEMPORAL: datos de entrega por sucursal. Los entregará la API con el negocio.
export function getEntrega() {
  return {
    sucursal: "Sucursal Roma Sur",
    recoger: { tiempo: "15-20 min", direccion: "Coahuila 142, Col. Roma" },
    domicilio: { tiempo: "30-40 min" },
  };
}

/** Solo desarrollo: ?error=1 simula un producto que dejó de estar disponible. */
export const simulaError = (url: URL) => flag(url, "error", "1");

// Preset `minimal` de DESIGN.md §3.2
export const tema = { brand: "#1c1f1a", bg: "#ffffff", text: "#1c1f1a" };

// TEMPORAL: seguimiento de pedido. Lo entregará la API con el token público.
export type EstadoPedido =
  | "pending"
  | "accepted"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "delivered"
  | "rejected";

const ESTADOS: EstadoPedido[] = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
  "rejected",
];

/** Solo desarrollo: ?estado=preparing, ?modalidad=domicilio|mesa, ?retraso=1 */
export function getPedido(token: string, url: URL, creados: PedidoCreado[] = []) {
  const creado = creados.find((p) => p.token === token);
  if (creado) {
    const { lineas, totalCents } = calcularLineas(creado.lineas);
    return {
      token,
      codigo: creado.codigo,
      estado: creado.estado,
      modalidad: creado.modalidad,
      mesa: creado.mesa ?? "",
      cliente: creado.cliente.nombre,
      retraso: flag(url, "retraso", "1"),
      motivoRechazo: creado.motivoRechazo ?? "El negocio no pudo atender tu pedido.",
      negocio: { nombre: "Tacos El Güero", telefono: "+525512345678" },
      lineas: lineas.map((l) => ({
        id: l.id,
        nombre: l.nombre,
        descripcion: `${formatMoney(l.totalCents / l.cantidad)} c/u`,
        cantidad: l.cantidad,
        totalCents: l.totalCents,
      })),
      totalCents,
    };
  }
  const estado = dev ? url.searchParams.get("estado") : null;
  const modalidad = dev ? url.searchParams.get("modalidad") : null;
  return {
    token,
    codigo: token.replace(/-/g, "").slice(0, 4).toUpperCase(),
    estado: ESTADOS.find((e) => e === estado) ?? ("preparing" as EstadoPedido),
    modalidad: modalidad === "domicilio" || modalidad === "mesa" ? modalidad : "recoger",
    mesa: "4",
    cliente: "Rodrigo Mendoza",
    retraso: flag(url, "retraso", "1"),
    motivoRechazo: "Nos quedamos sin pastor por hoy.",
    negocio: { nombre: "Tacos El Güero", telefono: "+525512345678" },
    lineas: flag(url, "vacio", "1")
      ? []
      : [
          {
            id: "pastor",
            nombre: "Pastor con piña",
            descripcion: "Tortilla de maíz artesanal ($22.00 c/u)",
            cantidad: 2,
            totalCents: 4400,
          },
          {
            id: "suadero",
            nombre: "Suadero confitado",
            descripcion: "Con cilantro y cebolla asada",
            cantidad: 1,
            totalCents: 2400,
          },
          {
            id: "horchata",
            nombre: "Agua de horchata (1L)",
            descripcion: "Receta casera con canela fresca",
            cantidad: 1,
            totalCents: 3500,
          },
        ],
    totalCents: 10300,
  };
}

// TEMPORAL: panel de pedidos en vivo. Lo entregará la API (`GET /pedidos` + transiciones).
export type EstadoPanel = "pending" | "accepted" | "preparing" | "ready" | "out_for_delivery";
export type Modalidad = "mesa" | "recoger" | "domicilio";

export type PedidoPanel = {
  id: string;
  codigo: string;
  modalidad: Modalidad;
  mesa?: string;
  estado: EstadoPanel;
  /** Minutos transcurridos desde que llegó el pedido. */
  haceMin: number;
  cliente: { nombre: string; telefono: string };
  direccion?: string;
  nota?: string;
  lineas: { id: string; cantidad: number; nombre: string; totalCents: number }[];
  tarifaEntregaCents?: number;
  totalCents: number;
};

/** Estados con los que un pedido sale del panel (ya no está activo). */
type EstadoFinal = "delivered" | "rejected";

const PEDIDOS_BASE: PedidoPanel[] = [
  {
    id: "p1045",
    codigo: "1045",
    modalidad: "recoger",
    estado: "pending",
    haceMin: 2,
    cliente: { nombre: "Sofía Garza", telefono: "+52 55 9876 5432" },
    nota: "Con bastante limón y salsas aparte",
    lineas: [
      { id: "pastor", cantidad: 3, nombre: "Pastor con piña", totalCents: 6600 },
      { id: "gringa", cantidad: 1, nombre: "Gringa de pastor", totalCents: 4500 },
      { id: "horchata", cantidad: 1, nombre: "Agua de horchata 1L", totalCents: 3500 },
    ],
    totalCents: 14600,
  },
  {
    id: "p1046",
    codigo: "1046",
    modalidad: "domicilio",
    estado: "pending",
    haceMin: 4,
    cliente: { nombre: "Carlos Slim H.", telefono: "+52 55 3344 5566" },
    direccion: "Coahuila 142 Depto 302, Roma Norte",
    lineas: [
      { id: "suadero", cantidad: 4, nombre: "Suadero confitado", totalCents: 9600 },
      { id: "cola", cantidad: 2, nombre: "Coca-Cola de vidrio", totalCents: 5600 },
    ],
    tarifaEntregaCents: 3500,
    totalCents: 18700,
  },
  {
    id: "p1044",
    codigo: "1044",
    modalidad: "mesa",
    mesa: "4",
    estado: "preparing",
    haceMin: 11,
    cliente: { nombre: "Mariana Ochoa", telefono: "+52 55 1122 3344" },
    lineas: [
      { id: "pastor", cantidad: 2, nombre: "Pastor con piña", totalCents: 4400 },
      { id: "suadero", cantidad: 1, nombre: "Suadero confitado", totalCents: 2400 },
    ],
    totalCents: 6800,
  },
  {
    id: "p1043",
    codigo: "1043",
    modalidad: "recoger",
    estado: "preparing",
    haceMin: 15,
    cliente: { nombre: "Rodrigo Mendoza", telefono: "+52 55 4930 2819" },
    lineas: [
      { id: "pastor", cantidad: 2, nombre: "Pastor", totalCents: 4400 },
      { id: "horchata", cantidad: 1, nombre: "Horchata", totalCents: 3500 },
    ],
    totalCents: 7900,
  },
  {
    id: "p1042",
    codigo: "1042",
    modalidad: "domicilio",
    estado: "ready",
    haceMin: 22,
    cliente: { nombre: "Daniel Torres", telefono: "+52 55 7788 9900" },
    direccion: "Álvaro Obregón 85, Col. Roma",
    lineas: [
      { id: "pastor", cantidad: 4, nombre: "Pastor con piña", totalCents: 8800 },
      { id: "horchata", cantidad: 3, nombre: "Agua de horchata (1 L)", totalCents: 10500 },
    ],
    tarifaEntregaCents: 1700,
    totalCents: 21000,
  },
];

/** Transiciones válidas (DESIGN.md §7.1). La API será quien las decida. */
export function siguienteEstado(
  estado: EstadoPanel,
  modalidad: Modalidad,
): EstadoPanel | EstadoFinal {
  switch (estado) {
    case "pending":
      return "accepted";
    case "accepted":
      return "preparing";
    case "preparing":
      return "ready";
    case "ready":
      return modalidad === "domicilio" ? "out_for_delivery" : "delivered";
    case "out_for_delivery":
      return "delivered";
  }
}

const ESTADOS_VALIDOS = new Set<string>([
  "pending",
  "accepted",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
  "rejected",
]);

/** TEMPORAL: el avance de estado simulado vive en una cookie por usuario, nunca en el módulo. */
export type AvanceDemo = Record<string, EstadoPanel | EstadoFinal>;

export function leerAvanceDemo(raw: string | undefined): AvanceDemo {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const avance: AvanceDemo = {};
    for (const [id, estado] of Object.entries(parsed)) {
      if (typeof estado !== "string") continue;
      if (ESTADOS_VALIDOS.has(estado)) {
        avance[id] = estado as EstadoPanel | EstadoFinal;
      }
    }
    return avance;
  } catch {
    return {};
  }
}

export const COOKIE_AVANCE = "demo_avance";

export class PanelError extends Error {}

export async function getPanelPedidos(url: URL, avance: AvanceDemo, creados: PedidoCreado[] = []) {
  if (flag(url, "lento", "1")) await new Promise((r) => setTimeout(r, 1500));
  if (flag(url, "error", "1")) throw new PanelError("demo: error de carga");
  if (flag(url, "vacio", "1")) return [];
  return pedidosActivos(baseConCreados(creados), avance);
}

/** Pedidos aún en el panel, con el avance simulado aplicado. */
export function pedidosActivos(base: PedidoPanel[], avance: AvanceDemo): PedidoPanel[] {
  const activos: PedidoPanel[] = [];
  for (const pedido of base) {
    const estado = avance[pedido.id] ?? pedido.estado;
    if (estado === "delivered" || estado === "rejected") continue;
    activos.push({ ...pedido, estado });
  }
  return activos;
}

/** Solo para validar acciones: busca un pedido del panel por id. */
export function buscarPedido(
  id: string,
  avance: AvanceDemo,
  creados: PedidoCreado[] = [],
): PedidoPanel | undefined {
  return pedidosActivos(baseConCreados(creados), avance).find((p) => p.id === id);
}

export function contarNuevos(avance: AvanceDemo, creados: PedidoCreado[] = []): number {
  return pedidosActivos(baseConCreados(creados), avance).filter((p) => p.estado === "pending")
    .length;
}

// TEMPORAL: pedidos creados desde el checkout. Sin backend, viven en una cookie por navegador
// (nunca en el módulo, que en SSR se comparte entre usuarios) y guardan solo ids, cantidades,
// datos del cliente y estado. Nombres e importes se recalculan siempre desde el catálogo del
// servidor, de modo que el cliente no puede dictar precios. No hay sincronización entre
// navegadores: el pedido solo existe en el navegador que lo creó.
export type EstadoCreado = EstadoPanel | EstadoFinal;

export type PedidoCreado = {
  token: string;
  codigo: string;
  estado: EstadoCreado;
  modalidad: Modalidad;
  mesa?: string;
  cliente: { nombre: string; telefono: string };
  direccion?: string;
  nota?: string;
  motivoRechazo?: string;
  lineas: { id: string; cantidad: number }[];
  /** Marca de tiempo (ms) de creación. */
  creadoEn: number;
};

export const COOKIE_PEDIDOS = "demo_pedidos";
/** Tope para que la cookie quede por debajo de ~4 kB: se descartan los pedidos más antiguos. */
const MAX_PEDIDOS_CREADOS = 5;
const PRIMER_CODIGO = 1047; // continúa tras los pedidos base (#1042-#1046)

const esTexto = (v: unknown): v is string => typeof v === "string";
const esModalidad = (v: unknown): v is Modalidad =>
  esTexto(v) && MODALIDADES.some((modalidad) => modalidad === v);

export function leerPedidosCreados(raw: string | undefined): PedidoCreado[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const pedidos: PedidoCreado[] = [];
    for (const item of parsed as Record<string, unknown>[]) {
      if (typeof item !== "object" || item === null) continue;
      const { token, codigo, estado, modalidad, cliente, lineas, creadoEn } = item;
      const c = cliente as Record<string, unknown> | null;
      if (!esTexto(token) || !esTexto(codigo) || !esTexto(estado) || !esModalidad(modalidad))
        continue;
      if (!ESTADOS_VALIDOS.has(estado)) continue;
      if (typeof c !== "object" || c === null || !esTexto(c.nombre) || !esTexto(c.telefono))
        continue;
      if (!Array.isArray(lineas) || typeof creadoEn !== "number") continue;
      const lineasValidas = (lineas as Record<string, unknown>[]).filter(
        (l) => esTexto(l?.id) && Number.isInteger(l.cantidad) && (l.cantidad as number) >= 1,
      ) as { id: string; cantidad: number }[];
      pedidos.push({
        token,
        codigo,
        estado: estado as EstadoCreado,
        modalidad,
        mesa: esTexto(item.mesa) ? item.mesa : undefined,
        cliente: { nombre: c.nombre, telefono: c.telefono },
        direccion: esTexto(item.direccion) ? item.direccion : undefined,
        nota: esTexto(item.nota) ? item.nota : undefined,
        motivoRechazo: esTexto(item.motivoRechazo) ? item.motivoRechazo : undefined,
        lineas: lineasValidas.map(({ id, cantidad }) => ({ id, cantidad })),
        creadoEn,
      });
    }
    return pedidos;
  } catch {
    return [];
  }
}

export function serializarPedidosCreados(pedidos: PedidoCreado[]): string {
  return JSON.stringify(pedidos.slice(0, MAX_PEDIDOS_CREADOS));
}

/** Productos del servidor con los que se calculan importes (ids -> producto). */
function productosPorId() {
  const productos = new Map<string, { nombre: string; precioCents: number }>();
  for (const categoria of CATALOGO_BASE) {
    for (const p of categoria.productos) productos.set(p.id, p);
  }
  return productos;
}

/** Recalcula nombres e importes desde el catálogo del servidor; ignora ids desconocidos. */
function calcularLineas(entrada: { id: string; cantidad: number }[]) {
  const productos = productosPorId();
  const lineas: { id: string; nombre: string; cantidad: number; totalCents: number }[] = [];
  for (const { id, cantidad } of entrada) {
    const producto = productos.get(id);
    if (!producto) continue;
    lineas.push({
      id,
      nombre: producto.nombre,
      cantidad,
      totalCents: producto.precioCents * cantidad,
    });
  }
  return { lineas, totalCents: lineas.reduce((suma, l) => suma + l.totalCents, 0) };
}

export type NuevoPedido = {
  token: string;
  modalidad: Modalidad;
  mesa?: string;
  cliente: { nombre: string; telefono: string };
  direccion?: string;
  nota?: string;
  lineas: { id: string; cantidad: number }[];
};

/** TEMPORAL: valida que cada producto y opción sigan disponibles en el menú del servidor. */
export async function validarLineasPedido(
  lineas: { id: string; opcion: string }[],
  url: URL,
): Promise<string | null> {
  const menuPorId = new Map(
    (await getCategorias(url)).flatMap(({ productos }) =>
      productos.map((producto) => [producto.id, producto] as const),
    ),
  );
  for (const { id, opcion } of lineas) {
    const producto = menuPorId.get(id);
    if (!producto) {
      return "Un producto de tu pedido ya no está en el menú. Quítalo para continuar.";
    }
    const valores = producto.opciones?.valores;
    if (valores?.length ? !valores.includes(opcion) : opcion !== "") {
      return `Elige una opción válida para ${producto.nombre}.`;
    }
  }
  return null;
}

/**
 * Registra un pedido nuevo en `pedidos` (idempotente por token) y devuelve la lista nueva.
 * No recibe importes: se calculan al leer.
 */
export function crearPedido(pedidos: PedidoCreado[], nuevo: NuevoPedido): PedidoCreado[] {
  if (pedidos.some((p) => p.token === nuevo.token)) return pedidos;
  const ultimo = Math.max(PRIMER_CODIGO - 1, ...pedidos.map((p) => Number(p.codigo) || 0));
  const creado: PedidoCreado = {
    ...nuevo,
    codigo: String(ultimo + 1),
    estado: "pending",
    creadoEn: Date.now(),
  };
  return [creado, ...pedidos].slice(0, MAX_PEDIDOS_CREADOS);
}

/** Aplica un nuevo estado a un pedido creado; devuelve la lista nueva. */
export function actualizarPedidoCreado(
  pedidos: PedidoCreado[],
  token: string,
  cambios: { estado: EstadoCreado; motivoRechazo?: string },
): PedidoCreado[] {
  return pedidos.map((p) => (p.token === token ? { ...p, ...cambios } : p));
}

/** Pedidos creados con la forma del panel (id = token); los entregados o rechazados salen luego. */
function creadosComoPanel(creados: PedidoCreado[]): PedidoPanel[] {
  const ahora = Date.now();
  return creados
    .filter((p) => p.estado !== "delivered" && p.estado !== "rejected")
    .map((p) => ({
      id: p.token,
      codigo: p.codigo,
      modalidad: p.modalidad,
      mesa: p.mesa,
      estado: p.estado as EstadoPanel,
      haceMin: Math.max(0, Math.floor((ahora - p.creadoEn) / 60000)),
      cliente: p.cliente,
      direccion: p.direccion,
      nota: p.nota,
      lineas: calcularLineas(p.lineas).lineas,
      totalCents: calcularLineas(p.lineas).totalCents,
    }));
}

const baseConCreados = (creados: PedidoCreado[]) => [...creadosComoPanel(creados), ...PEDIDOS_BASE];

// TEMPORAL: negocio de la sesión simulada del panel y métricas del día.
export function getNegocioPanel(url: URL) {
  return {
    nombre: NOMBRE_NEGOCIO_DEMO,
    slug: slugNegocioDemo,
    sucursal: NOMBRE_NEGOCIO_DEMO,
    abierto: !flag(url, "abierto", "false"),
  };
}

export function getResumenPanel(pedidos: PedidoPanel[]) {
  const porModalidad = new Map<Modalidad, number>();
  for (const p of pedidos) porModalidad.set(p.modalidad, (porModalidad.get(p.modalidad) ?? 0) + 1);
  const top = [...porModalidad.entries()].toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    activos: pedidos.length,
    tiempoCocinaMin: 14, // TEMPORAL: promedio que calculará la API
    ventaHoyCents: 68800, // TEMPORAL: incluye pedidos ya entregados
    canal: top,
  };
}

// TEMPORAL: catálogo editable del panel (`/app/catalogo`). Lo entregará la API del negocio.
export type VarianteCatalogo = {
  id: string;
  nombre: string;
  /** Costo adicional en centavos. */
  extraCents: number;
  activa: boolean;
};

export type ProductoCatalogo = {
  id: string;
  nombre: string;
  descripcion: string;
  precioCents: number;
  disponible: boolean;
  imagen?: string;
  variantes: VarianteCatalogo[];
};

export type CategoriaCatalogo = { id: string; nombre: string; productos: ProductoCatalogo[] };

/** Resultado de una form action del catálogo (cada componente lo filtra por `id`). */
export type ResultadoCatalogo = {
  ok: boolean;
  accion:
    | "guardar"
    | "eliminar"
    | "agregar-producto"
    | "agregar-categoria"
    | "eliminar-categoria"
    | "mover-categoria"
    | "agregar-variante"
    | "alternar-variante"
    | "subir-foto";
  id: string;
  mensaje?: string;
  error?: string;
  fieldErrors?: { nombre?: string; precio?: string; extra?: string };
  values?: { nombre?: string; precio?: string; extra?: string };
};

const CATALOGO_BASE: CategoriaCatalogo[] = [
  {
    id: "tacos",
    nombre: "Tacos",
    productos: [
      {
        id: "pastor",
        nombre: "Pastor con piña",
        descripcion: "Marinado artesanal en trompo, cilantro, cebolla y rebanada de piña asada.",
        precioCents: 2200,
        disponible: true,
        imagen: PLACEHOLDER_IMAGE,
        variantes: [
          { id: "maiz", nombre: "Tortilla de maíz nixtamalizada", extraCents: 0, activa: true },
          { id: "harina", nombre: "Tortilla de harina de trigo", extraCents: 500, activa: true },
        ],
      },
      {
        id: "suadero",
        nombre: "Suadero confitado",
        descripcion: "Carne de res cocinada a fuego lento en manteca hasta quedar dorada y jugosa.",
        precioCents: 2400,
        disponible: true,
        imagen: PLACEHOLDER_IMAGE,
        variantes: [],
      },
      {
        id: "gringa",
        nombre: "Gringa de pastor",
        descripcion: "Dos tortillas de harina rellenas con queso oaxaca fundido y carne al pastor.",
        precioCents: 4500,
        disponible: false,
        variantes: [],
      },
    ],
  },
  {
    id: "bebidas",
    nombre: "Bebidas",
    productos: [
      {
        id: "horchata",
        nombre: "Agua de horchata (1 L)",
        descripcion:
          "Elaborada con arroz, leche condensada y un toque aromático de canela mexicana.",
        precioCents: 3500,
        disponible: true,
        imagen: PLACEHOLDER_IMAGE,
        variantes: [],
      },
      {
        id: "cola",
        nombre: "Coca-Cola de vidrio (355ml)",
        descripcion: "Refresco embotellado de vidrio, servido bien frío.",
        precioCents: 2800,
        disponible: true,
        imagen: PLACEHOLDER_IMAGE,
        variantes: [],
      },
    ],
  },
];

/** TEMPORAL: las ediciones simuladas viven en una cookie por usuario, nunca en el módulo. */
export type CambiosCatalogo = {
  productos: Record<
    string,
    { precioCents?: number; disponible?: boolean; eliminado?: boolean; conFoto?: boolean }
  >;
  /** Clave `${productoId}:${varianteId}` → activa. */
  variantes: Record<string, boolean>;
  nuevasVariantes: (VarianteCatalogo & { productoId: string })[];
  nuevosProductos: { id: string; categoriaId: string; nombre: string; precioCents: number }[];
  nuevasCategorias: { id: string; nombre: string }[];
  categoriasEliminadas: string[];
  /** Orden de ids de categoría; las que falten van al final. */
  orden: string[];
};

export const COOKIE_CATALOGO = "demo_catalogo";
/** Las cookies admiten ~4 kB; con este tope la demo avisa antes de que el navegador la descarte. */
export const LIMITE_COOKIE_CATALOGO = 3500;

export const cambiosCatalogoVacios = (): CambiosCatalogo => ({
  productos: {},
  variantes: {},
  nuevasVariantes: [],
  nuevosProductos: [],
  nuevasCategorias: [],
  categoriasEliminadas: [],
  orden: [],
});

const esRegistro = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function lista<T>(v: unknown, valido: (x: unknown) => x is T): T[] {
  return Array.isArray(v) ? v.filter(valido) : [];
}

export function leerCambiosCatalogo(raw: string | undefined): CambiosCatalogo {
  const vacio = cambiosCatalogoVacios();
  if (!raw) return vacio;
  try {
    const p: unknown = JSON.parse(raw);
    if (!esRegistro(p)) return vacio;
    return {
      productos: esRegistro(p.productos) ? (p.productos as CambiosCatalogo["productos"]) : {},
      variantes: esRegistro(p.variantes) ? (p.variantes as CambiosCatalogo["variantes"]) : {},
      nuevasVariantes: lista(
        p.nuevasVariantes,
        (x): x is CambiosCatalogo["nuevasVariantes"][number] =>
          esRegistro(x) &&
          typeof x.id === "string" &&
          typeof x.productoId === "string" &&
          typeof x.nombre === "string" &&
          typeof x.extraCents === "number" &&
          typeof x.activa === "boolean",
      ),
      nuevosProductos: lista(
        p.nuevosProductos,
        (x): x is CambiosCatalogo["nuevosProductos"][number] =>
          esRegistro(x) &&
          typeof x.id === "string" &&
          typeof x.categoriaId === "string" &&
          typeof x.nombre === "string" &&
          typeof x.precioCents === "number",
      ),
      nuevasCategorias: lista(
        p.nuevasCategorias,
        (x): x is CambiosCatalogo["nuevasCategorias"][number] =>
          esRegistro(x) && typeof x.id === "string" && typeof x.nombre === "string",
      ),
      categoriasEliminadas: lista(
        p.categoriasEliminadas,
        (x): x is string => typeof x === "string",
      ),
      orden: lista(p.orden, (x): x is string => typeof x === "string"),
    };
  } catch {
    return vacio;
  }
}

/** Catálogo base con las ediciones simuladas aplicadas, en el orden elegido. */
export function aplicarCambiosCatalogo(cambios: CambiosCatalogo): CategoriaCatalogo[] {
  const todas = [
    ...CATALOGO_BASE.map((c) => ({ id: c.id, nombre: c.nombre })),
    ...cambios.nuevasCategorias,
  ].filter((c) => !cambios.categoriasEliminadas.includes(c.id));

  const ids = todas.map((c) => c.id);
  const orden = [
    ...cambios.orden.filter((id) => ids.includes(id)),
    ...ids.filter((id) => !cambios.orden.includes(id)),
  ];

  return orden.flatMap((id) => {
    const categoria = todas.find((c) => c.id === id);
    if (!categoria) return [];
    const base = CATALOGO_BASE.find((c) => c.id === id)?.productos ?? [];
    const nuevos: ProductoCatalogo[] = cambios.nuevosProductos
      .filter((n) => n.categoriaId === id)
      .map((n) => ({
        id: n.id,
        nombre: n.nombre,
        descripcion: "",
        precioCents: n.precioCents,
        disponible: true,
        variantes: [],
      }));

    const productos = [...base, ...nuevos].flatMap((producto) => {
      const edicion = cambios.productos[producto.id];
      if (edicion?.eliminado) return [];
      const variantes = [
        ...producto.variantes,
        ...cambios.nuevasVariantes.filter((v) => v.productoId === producto.id),
      ].map((v) => ({ ...v, activa: cambios.variantes[`${producto.id}:${v.id}`] ?? v.activa }));
      return [
        {
          ...producto,
          precioCents: edicion?.precioCents ?? producto.precioCents,
          disponible: edicion?.disponible ?? producto.disponible,
          imagen: edicion?.conFoto ? PLACEHOLDER_IMAGE : producto.imagen,
          variantes,
        },
      ];
    });
    return [{ id, nombre: categoria.nombre, productos }];
  });
}

export class CatalogoError extends Error {}

/** Solo desarrollo: ?lento=1, ?error=1 y ?vacio=1 muestran carga, error y vacío. */
export async function getCatalogo(url: URL, cambios: CambiosCatalogo) {
  if (flag(url, "lento", "1")) await new Promise((r) => setTimeout(r, 1500));
  if (flag(url, "error", "1")) throw new CatalogoError("demo: error de carga");
  return flag(url, "vacio", "1") ? [] : aplicarCambiosCatalogo(cambios);
}

// TEMPORAL: lo que ve el comensal. Es el mismo catálogo del panel, sin lo agotado.
export type ProductoMenu = {
  id: string;
  nombre: string;
  descripcion: string;
  precioCents: number;
  imagen?: string;
  opciones?: { titulo: string; valores: string[] };
};

export async function getCategorias(url: URL, cambios = cambiosCatalogoVacios()) {
  if (flag(url, "lento", "1")) await new Promise((r) => setTimeout(r, 1500));
  if (flag(url, "vacio", "1")) return [];
  return aplicarCambiosCatalogo(cambios).map((categoria) => ({
    id: categoria.id,
    nombre: categoria.nombre,
    productos: categoria.productos
      .filter((p) => p.disponible)
      .map((p): ProductoMenu => {
        const valores = p.variantes.filter((v) => v.activa).map((v) => v.nombre);
        return {
          id: p.id,
          nombre: p.nombre,
          descripcion: p.descripcion,
          precioCents: p.precioCents,
          imagen: p.imagen,
          // TEMPORAL: el extra de cada variante aún no se suma al precio del carrito.
          opciones: valores.length > 0 ? { titulo: "Opción", valores } : undefined,
        };
      }),
  }));
}

export function getResumenCatalogo(categorias: CategoriaCatalogo[]) {
  const productos = categorias.flatMap((c) => c.productos);
  return {
    activos: productos.filter((p) => p.disponible).length,
    productos: productos.length,
    categorias: categorias.length,
    sincronizado: true, // TEMPORAL: el estado real lo reportará la API
    moneda: "MXN ($)", // TEMPORAL: vendrá de los ajustes del negocio
  };
}

// ---------------------------------------------------------------------------
// TEMPORAL: ajustes del negocio (/app/ajustes). Los entregará la API; mientras,
// los cambios se guardan en una cookie por usuario.
// ---------------------------------------------------------------------------
export type PresetTema = "minimal" | "dark" | "vibrant";
export type FuenteTema = "sans" | "rounded" | "serif";
export type RolEquipo = "admin" | "cocina" | "mesera";

export type PresetInfo = {
  id: PresetTema;
  nombre: string;
  descripcion: string;
  brand: string;
  bg: string;
  text: string;
};

// DESIGN.md §3.2
export const PRESETS_TEMA: PresetInfo[] = [
  {
    id: "minimal",
    nombre: "Minimalista",
    descripcion: "Fondo blanco, botón oscuro",
    brand: "#1C1F1A",
    bg: "#FFFFFF",
    text: "#1C1F1A",
  },
  {
    id: "dark",
    nombre: "Nocturno",
    descripcion: "Tinta negra y compasúchil",
    brand: "#F5A300",
    bg: "#17191A",
    text: "#F2F2EE",
  },
  {
    id: "vibrant",
    nombre: "Vibrante",
    descripcion: "Cálido con acento jamaica",
    brand: "#C2185B",
    bg: "#FFF8F2",
    text: "#2A1A12",
  },
];

export const FUENTES_TEMA: { id: FuenteTema; nombre: string; familia: string }[] = [
  { id: "sans", nombre: "Onest Sans", familia: '"Onest", system-ui, sans-serif' },
  { id: "rounded", nombre: "Redondeada", familia: '"Nunito", system-ui, sans-serif' },
  { id: "serif", nombre: "Editorial Serif", familia: '"Source Serif 4", Georgia, serif' },
];

export const ROLES_EQUIPO: { id: RolEquipo; nombre: string }[] = [
  { id: "admin", nombre: "Admin total" },
  { id: "cocina", nombre: "Cocina / KDS" },
  { id: "mesera", nombre: "Mesera" },
];

export type MiembroEquipo = {
  id: string;
  nombre: string;
  correo: string;
  rol: RolEquipo | "dueno";
  pendiente?: boolean;
};

export type AjustesDemo = {
  tema: { preset: PresetTema; primario: string; fuente: FuenteTema };
  servicio: {
    mesa: boolean;
    recoger: boolean;
    domicilio: boolean;
    abre: string;
    cierra: string;
    tiempoMin: number;
  };
  zonas: { id: string; nombre: string; costoCents: number }[];
  equipo: MiembroEquipo[];
  mesas: number;
  versionMenu: string;
};

export const COOKIE_AJUSTES = "demo_ajustes";
export const MAX_MESAS = 30;

const AJUSTES_BASE: AjustesDemo = {
  tema: { preset: "minimal", primario: "#1F5C45", fuente: "sans" },
  servicio: {
    mesa: true,
    recoger: true,
    domicilio: true,
    abre: "09:00",
    cierra: "23:00",
    tiempoMin: 25,
  },
  zonas: [
    { id: "z1", nombre: "Centro / Roma / Condesa", costoCents: 3500 },
    { id: "z2", nombre: "Del Valle / Narvarte", costoCents: 4500 },
  ],
  equipo: [
    { id: "u1", nombre: "Juan González", correo: "juan@tacoselguero.mx", rol: "dueno" },
    { id: "u2", nombre: "Mateo Trejo", correo: "cocina1@tacoselguero.mx", rol: "cocina" },
    { id: "u3", nombre: "Sofía Ramírez", correo: "sofia@tacoselguero.mx", rol: "mesera" },
  ],
  mesas: 8,
  versionMenu: "v2.4",
};

/** Lee los cambios simulados; ignora cualquier valor que no tenga la forma esperada. */
export function leerAjustesDemo(raw: string | undefined): AjustesDemo {
  const base = structuredClone(AJUSTES_BASE);
  if (!raw) return base;
  try {
    const dato: unknown = JSON.parse(raw);
    if (typeof dato !== "object" || dato === null) return base;
    const d = dato as Partial<AjustesDemo>;
    if (d.tema && typeof d.tema.primario === "string") base.tema = d.tema;
    if (d.servicio && typeof d.servicio.tiempoMin === "number") base.servicio = d.servicio;
    if (Array.isArray(d.zonas)) base.zonas = d.zonas;
    if (Array.isArray(d.equipo)) base.equipo = d.equipo;
    if (typeof d.mesas === "number") base.mesas = d.mesas;
    return base;
  } catch {
    return base;
  }
}

export async function getAjustes(url: URL, raw: string | undefined): Promise<AjustesDemo> {
  if (flag(url, "lento", "1")) await new Promise((r) => setTimeout(r, 1500));
  if (simulaError(url)) throw new PanelError("ajustes");
  return leerAjustesDemo(raw);
}

/** Color `#RRGGBB` en mayúsculas, o `null` si no es válido. */
export function normalizaHex(valor: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(valor.trim());
  return m?.[1] ? `#${m[1].toUpperCase()}` : null;
}

function luminancia(hex: string): number {
  const canal = (i: number) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

export function contraste(a: string, b: string): number {
  const [la, lb] = [luminancia(a), luminancia(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const [presetBase = PRESETS_TEMA[0] as PresetInfo] = PRESETS_TEMA;
const [fuenteBase = FUENTES_TEMA[0] as (typeof FUENTES_TEMA)[number]] = FUENTES_TEMA;

/** Tema del menú público a partir de lo guardado en ajustes (preset + color primario + fuente). */
export function resolverTema(ajustes: AjustesDemo) {
  const preset = PRESETS_TEMA.find((p) => p.id === ajustes.tema.preset) ?? presetBase;
  const fuente = FUENTES_TEMA.find((f) => f.id === ajustes.tema.fuente) ?? fuenteBase;
  const primario = normalizaHex(ajustes.tema.primario);
  // Un valor que no cumple el contraste (cookie manipulada) vuelve al color del preset.
  const brand = primario && contraste(primario, preset.bg) >= 4.5 ? primario : preset.brand;
  return { brand, bg: preset.bg, text: preset.text, fuente: fuente.id, familia: fuente.familia };
}
