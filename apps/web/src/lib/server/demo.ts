// TEMPORAL: datos de ejemplo hasta que exista el contrato del menú público en
// `packages/contracts` y el cliente tipado `#lib/server/api.ts`. Borrar entonces.
import { dev } from "$app/env";
import { PLACEHOLDER_IMAGE } from "#lib/images.js";

/** Banderas solo para desarrollo: ?abierto=false, ?vacio=1, ?lento=1 */
const flag = (url: URL, name: string, value: string) => dev && url.searchParams.get(name) === value;

// TEMPORAL: negocio mostrado en la pantalla de activación.
export const slugNegocioDemo = "tacos-el-guero";

export function getNegocio(slug: string, url: URL) {
  return {
    slug,
    nombre: "Tacos El Güero",
    abierto: !flag(url, "abierto", "false"),
    cierra: "23:00",
    abre: "09:00",
  };
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

export async function getCategorias(url: URL) {
  if (flag(url, "lento", "1")) await new Promise((r) => setTimeout(r, 1500));
  if (flag(url, "vacio", "1")) return [];
  return [
    {
      id: "tacos",
      nombre: "Tacos",
      productos: [
        {
          id: "pastor",
          nombre: "Pastor con piña",
          descripcion: "Carne adobada al trompo, cilantro fresco, cebolla picada y piña asada.",
          precioCents: 2200,
          imagen: PLACEHOLDER_IMAGE,
          opciones: { titulo: "Tortilla", valores: ["Maíz", "Harina"] },
        },
        {
          id: "suadero",
          nombre: "Suadero confitado",
          descripcion: "Suadero suave cocinado lentamente en comal con doble tortilla taquera.",
          precioCents: 2400,
          imagen: PLACEHOLDER_IMAGE,
        },
        {
          id: "gringa",
          nombre: "Gringa de pastor",
          descripcion: "Tortilla de harina grande con queso asadero fundido y carne al pastor.",
          precioCents: 4500,
          imagen: PLACEHOLDER_IMAGE,
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
          descripcion: "Receta artesanal de la casa con arroz y canela fresca.",
          precioCents: 3500,
          imagen: PLACEHOLDER_IMAGE,
        },
        {
          id: "cola",
          nombre: "Coca-Cola de vidrio",
          descripcion: "Presentación mexicana original de 355 ml bien fría.",
          precioCents: 2800,
          imagen: PLACEHOLDER_IMAGE,
        },
      ],
    },
  ];
}

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
export function getPedido(token: string, url: URL) {
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

export async function getPanelPedidos(url: URL, avance: AvanceDemo) {
  if (flag(url, "lento", "1")) await new Promise((r) => setTimeout(r, 1500));
  if (flag(url, "error", "1")) throw new PanelError("demo: error de carga");
  return pedidosActivos(flag(url, "vacio", "1") ? [] : PEDIDOS_BASE, avance);
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
export function buscarPedido(id: string, avance: AvanceDemo): PedidoPanel | undefined {
  return pedidosActivos(PEDIDOS_BASE, avance).find((p) => p.id === id);
}

export function contarNuevos(avance: AvanceDemo): number {
  return pedidosActivos(PEDIDOS_BASE, avance).filter((p) => p.estado === "pending").length;
}

// TEMPORAL: negocio de la sesión simulada del panel y métricas del día.
export function getNegocioPanel(url: URL) {
  return {
    nombre: "Taquería El Nopal",
    slug: "taqueria-el-nopal",
    sucursal: "Taquería El Nopal",
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
        nombre: "Agua de horchata (1L)",
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
