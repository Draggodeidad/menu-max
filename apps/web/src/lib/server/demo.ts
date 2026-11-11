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
