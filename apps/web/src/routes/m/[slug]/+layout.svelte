<script lang="ts">
  import { navigating } from "$app/state";
  import type { LayoutProps } from "./$types";
  import { Cart, setCart } from "#lib/cart.svelte.js";
  import StorefrontSkeleton from "#lib/components/StorefrontSkeleton.svelte";

  let { data, children }: LayoutProps = $props();

  // svelte-ignore state_referenced_locally -- el carrito se crea una vez por negocio
  const cart = new Cart(data.negocio.slug);
  setCart(cart);

  // Sincroniza con el almacenamiento del navegador (sistema externo).
  $effect(() => cart.hydrate());
  $effect(() => {
    if (cart.ready) cart.persist();
  });

  const cargando = $derived.by(() => {
    const id = navigating.to?.route.id;
    if (id === "/m/[slug]") return "menu";
    if (id === "/m/[slug]/pedido") return "pedido";
    return null;
  });

  // Solo variables del tema del negocio: el storefront no usa colores de MenusMax.
  // Derivados: ver DESIGN.md §3.6.
  const vars = $derived(
    `--brand:${data.tema.brand};--brand-bg:${data.tema.bg};--brand-text:${data.tema.text};` +
      `--brand-muted:color-mix(in srgb,${data.tema.text} 70%,${data.tema.bg});` +
      `--brand-line:color-mix(in srgb,${data.tema.text} 12%,${data.tema.bg});` +
      `--brand-tint:color-mix(in srgb,${data.tema.text} 8%,${data.tema.bg})`,
  );
</script>

<svelte:head>
  <title>{data.negocio.nombre} · Menú</title>
  <meta
    name="description"
    content="Menú de {data.negocio.nombre}. Elige tus productos y envía tu pedido."
  />
  <meta property="og:title" content="{data.negocio.nombre} · Menú" />
</svelte:head>

<div style={vars} class="min-h-dvh bg-(color:--brand-bg) text-(color:--brand-text)">
  {@render children()}

  {#if cargando}
    <div class="fixed inset-0 z-30 overflow-y-auto">
      <StorefrontSkeleton variant={cargando} />
    </div>
  {/if}
</div>
