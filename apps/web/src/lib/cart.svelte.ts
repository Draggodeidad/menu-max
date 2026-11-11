import { untrack } from "svelte";
import { getContext, setContext } from "svelte";

export type CartLine = {
  key: string;
  productId: string;
  nombre: string;
  opcion?: string;
  /** Solo para mostrar: el total definitivo lo calcula la API. */
  precioCents: number;
  cantidad: number;
};

const MAX_QTY = 99;

const isLine = (l: unknown): l is CartLine =>
  !!l &&
  typeof l === "object" &&
  typeof (l as CartLine).key === "string" &&
  typeof (l as CartLine).productId === "string" &&
  typeof (l as CartLine).nombre === "string" &&
  Number.isInteger((l as CartLine).precioCents) &&
  Number.isInteger((l as CartLine).cantidad) &&
  (l as CartLine).cantidad >= 1 &&
  (l as CartLine).cantidad <= MAX_QTY;

export class Cart {
  lines = $state<CartLine[]>([]);
  /** false hasta leer el almacenamiento del navegador; en SSR nunca es true. */
  ready = $state(false);

  count = $derived(this.lines.reduce((sum, l) => sum + l.cantidad, 0));
  totalCents = $derived(this.lines.reduce((sum, l) => sum + l.precioCents * l.cantidad, 0));

  #storageKey: string;

  constructor(slug: string) {
    this.#storageKey = `menusmax:cart:${slug}`;
  }

  add(item: Omit<CartLine, "key" | "cantidad">) {
    const key = `${item.productId}:${item.opcion ?? ""}`;
    const line = this.lines.find((l) => l.key === key);
    if (line) line.cantidad = Math.min(MAX_QTY, line.cantidad + 1);
    else this.lines.push({ ...item, key, cantidad: 1 });
  }

  setQty(key: string, cantidad: number) {
    if (cantidad < 1) this.lines = this.lines.filter((l) => l.key !== key);
    else {
      const line = this.lines.find((l) => l.key === key);
      if (line) line.cantidad = Math.min(MAX_QTY, cantidad);
    }
  }

  clear() {
    this.lines = [];
  }

  hydrate() {
    untrack(() => {
      try {
        const parsed = JSON.parse(localStorage.getItem(this.#storageKey) ?? "[]");
        if (Array.isArray(parsed)) this.lines = parsed.filter(isLine);
      } catch {
        // almacenamiento bloqueado o dato corrupto: se empieza vacío
      }
      this.ready = true;
    });
  }

  persist() {
    const data = JSON.stringify(this.lines);
    try {
      localStorage.setItem(this.#storageKey, data);
    } catch {
      // sin almacenamiento: el carrito vive solo en memoria
    }
  }
}

const KEY = Symbol("cart");

export const setCart = (cart: Cart) => setContext(KEY, cart);
export const getCart = () => getContext<Cart>(KEY);
