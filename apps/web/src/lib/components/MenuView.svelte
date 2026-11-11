<script lang="ts">
  import { fly } from "svelte/transition";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Plus from "@lucide/svelte/icons/plus";
  import ProductImage from "#lib/components/ProductImage.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import type { Cart } from "#lib/cart.svelte.js";
  import { formatMoney } from "#lib/money.js";
  import { cn } from "#lib/utils.js";

  type Producto = {
    id: string;
    nombre: string;
    descripcion: string;
    precioCents: number;
    imagen?: string;
    opciones?: { titulo: string; valores: string[] };
  };
  type Categoria = { id: string; nombre: string; productos: Producto[] };

  let {
    negocio,
    categorias,
    mesa = null,
    cart,
    pedidoHref,
    preview = false,
  }: {
    negocio: { nombre: string; abierto: boolean; cierra: string; abre: string };
    categorias: Categoria[];
    mesa?: string | null;
    cart?: Cart;
    pedidoHref?: string;
    /** Vista previa del panel: deshabilita las acciones. */
    preview?: boolean;
  } = $props();

  // Sin JavaScript no hay carrito: los controles de pedido se ocultan (ver DESIGN.md §10).
  let listo = $state(false);
  $effect(() => {
    listo = true;
  });

  const visibles = $derived(categorias.filter((c) => c.productos.length > 0));
  const puedeAgregar = $derived(negocio.abierto && !preview && !!cart);

  let activa = $state<string | null>(null);
  const activaId = $derived(activa ?? visibles[0]?.id);
  let elegidas = $state<Record<string, string>>({});

  // Sincroniza el chip activo con la sección visible (APIs del navegador).
  $effect(() => {
    const secciones = visibles
      .map((c) => document.getElementById(`cat-${c.id}`))
      .filter((el): el is HTMLElement => !!el);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((e) => e.isIntersecting);
        if (visible) activa = visible.target.id.replace("cat-", "");
      },
      { rootMargin: "-120px 0px -65% 0px" },
    );
    secciones.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  });

  function agregar(p: Producto) {
    const opcion = p.opciones ? (elegidas[p.id] ?? p.opciones.valores[0]) : undefined;
    cart?.add({ productId: p.id, nombre: p.nombre, opcion, precioCents: p.precioCents });
  }
</script>

<div
  class="mx-auto min-h-dvh max-w-md bg-(color:--brand-bg) md:border-x md:border-(color:--brand-line)"
>
  <header class="px-5 pt-6 pb-5">
    <noscript>
      <p class="mb-3 text-sm text-(color:--brand-muted)">
        Puedes leer el menú completo. Para armar tu pedido activa JavaScript.
      </p>
    </noscript>
    {#if mesa}
      <p
        class="mb-3 inline-flex h-8 items-center gap-1.5 rounded-full bg-(color:--brand-tint) px-3 text-sm font-medium"
      >
        <Check class="size-3.5" aria-hidden="true" />
        Mesa {mesa}
      </p>
    {/if}
    <h1 class="text-3xl font-bold tracking-[-0.03em]">{negocio.nombre}</h1>
    <p class="mt-1.5 text-base text-(color:--brand-muted)">
      {#if negocio.abierto}
        Abierto · cierra {negocio.cierra}
      {:else}
        Cerrado · abre a las {negocio.abre}
      {/if}
    </p>
  </header>

  <nav
    hidden={visibles.length === 0}
    aria-label="Categorías"
    class="sticky top-0 z-10 flex gap-2 overflow-x-auto border-y border-(color:--brand-line) bg-(color:--brand-bg) px-5 py-3"
  >
    {#each visibles as c (c.id)}
      <a
        href="#cat-{c.id}"
        aria-current={activaId === c.id ? "true" : undefined}
        class={cn(
          "inline-flex h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-(color:--brand)/30",
          activaId === c.id
            ? "border-(color:--brand) bg-(color:--brand) text-(color:--brand-bg)"
            : "border-(color:--brand-line) hover:bg-(color:--brand-tint)",
        )}
      >
        {c.nombre}
      </a>
    {/each}
  </nav>

  <main class="px-5 pb-32">
    {#if visibles.length === 0}
      <div class="py-16">
        <h2 class="text-xl font-semibold tracking-[-0.02em]">Aún no hay productos en este menú</h2>
        <p class="mt-2 max-w-[60ch] text-base leading-relaxed text-(color:--brand-muted)">
          {negocio.nombre} todavía no publica su carta. Vuelve en un rato o pregunta al personal.
        </p>
        <Button
          href=""
          variant="outline"
          class="mt-6 border-(color:--brand-line) bg-transparent text-(color:--brand-text) hover:bg-(color:--brand-tint)"
        >
          Actualizar menú
        </Button>
      </div>
    {/if}
    {#each visibles as c (c.id)}
      <section id="cat-{c.id}" aria-labelledby="h-{c.id}" class="scroll-mt-20 pt-8 first:pt-6">
        <h2
          id="h-{c.id}"
          class="border-b border-(color:--brand-line) pb-3 text-xl font-semibold tracking-[-0.02em]"
        >
          {c.nombre}
        </h2>
        <ul>
          {#each c.productos as p (p.id)}
            <li class="border-b border-(color:--brand-line) py-5 last:border-b-0">
              <div class="flex gap-4">
                <div class="min-w-0 flex-1">
                  <h3 class="text-base font-semibold">{p.nombre}</h3>
                  <p class="mt-1 text-sm leading-relaxed text-(color:--brand-muted)">
                    {p.descripcion}
                  </p>
                  <p class="mt-3 font-semibold tabular-nums">{formatMoney(p.precioCents)}</p>
                </div>
                <div class="flex shrink-0 flex-col items-end justify-between gap-3">
                  {#if p.imagen}
                    <ProductImage src={p.imagen} alt={p.nombre} />
                  {/if}
                  {#if listo}
                    <Button
                      size="icon"
                      aria-label="Agregar {p.nombre}"
                      disabled={!puedeAgregar}
                      onclick={() => agregar(p)}
                      class="mt-auto rounded-full bg-(color:--brand) text-(color:--brand-bg) hover:bg-(color:--brand)/90"
                    >
                      <Plus aria-hidden="true" />
                    </Button>
                  {/if}
                </div>
              </div>

              {#if p.opciones && listo}
                <details class="group mt-3">
                  <summary
                    class="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-lg text-sm font-medium text-(color:--brand-muted) outline-none focus-visible:ring-2 focus-visible:ring-(color:--brand)/30 [&::-webkit-details-marker]:hidden"
                  >
                    Elige {p.opciones.titulo.toLowerCase()}
                    <ChevronDown
                      class="size-4 transition-transform motion-reduce:transition-none group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <fieldset class="flex flex-wrap gap-2 pt-1">
                    <legend class="sr-only">{p.opciones.titulo}</legend>
                    {#each p.opciones.valores as v, i (v)}
                      <label class="relative">
                        <input
                          type="radio"
                          name="op-{p.id}"
                          value={v}
                          checked={i === 0}
                          onchange={() => (elegidas[p.id] = v)}
                          class="peer sr-only"
                        />
                        <span
                          class="inline-flex h-11 items-center rounded-full border border-(color:--brand-line) px-4 text-sm font-medium peer-checked:border-(color:--brand) peer-checked:bg-(color:--brand) peer-checked:text-(color:--brand-bg) peer-focus-visible:ring-2 peer-focus-visible:ring-(color:--brand)/30"
                        >
                          {v}
                        </span>
                      </label>
                    {/each}
                  </fieldset>
                </details>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </main>

  {#if cart}
    <span class="sr-only" aria-live="polite">
      {cart.count}
      {cart.count === 1 ? "producto" : "productos"} en tu pedido
    </span>
    {#if cart.count > 0 && !preview}
      <div
        transition:fly={{ y: 80, duration: 200 }}
        class="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <a
          href={pedidoHref}
          class="flex h-14 items-center justify-between rounded-xl bg-(color:--brand) px-5 text-(color:--brand-bg) shadow-[0_12px_28px_-10px_color-mix(in_srgb,var(--brand-text)_45%,transparent)] outline-none focus-visible:ring-2 focus-visible:ring-(color:--brand)/40 focus-visible:ring-offset-2 focus-visible:ring-offset-(color:--brand-bg)"
        >
          <span class="font-semibold">Ver pedido</span>
          <span class="flex items-center gap-3">
            {#key cart.count}
              <span
                class="count-pop inline-flex size-7 items-center justify-center rounded-full bg-(color:--brand-bg) text-sm font-semibold text-(color:--brand) tabular-nums"
                aria-hidden="true">{cart.count}</span
              >
            {/key}
            <span class="font-semibold tabular-nums">{formatMoney(cart.totalCents)}</span>
          </span>
        </a>
      </div>
    {/if}
  {/if}
</div>

<style>
  @media (prefers-reduced-motion: no-preference) {
    .count-pop {
      animation: pop 150ms ease-out;
    }
  }
  @keyframes pop {
    50% {
      transform: scale(1.15);
    }
  }
</style>
