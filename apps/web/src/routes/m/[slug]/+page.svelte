<script lang="ts">
  import type { PageProps } from "./$types";
  import MenuView from "#lib/components/MenuView.svelte";
  import { getCart } from "#lib/cart.svelte.js";

  let { data }: PageProps = $props();
  // `data` del layout (negocio) se fusiona con el de la página.
  const cart = getCart();
</script>

{#if data.errorCarga}
  <main class="mx-auto min-h-dvh max-w-md px-5 pt-24">
    <div role="alert">
      <h1 class="text-xl font-semibold tracking-[-0.02em]">No pudimos cargar el menú</h1>
      <p class="mt-2 text-base leading-relaxed text-(color:--brand-muted)">
        Intenta de nuevo para ver los productos de {data.negocio.nombre}.
      </p>
    </div>
    <form method="GET" class="mt-6">
      {#if data.mesa}<input type="hidden" name="mesa" value={data.mesa} />{/if}
      <button
        type="submit"
        class="inline-flex h-12 items-center justify-center rounded-lg bg-(color:--brand) px-5 font-medium text-(color:--brand-bg) outline-none focus-visible:ring-2 focus-visible:ring-(color:--brand)/30"
        >Reintentar</button
      >
    </form>
  </main>
{:else}
  <MenuView
    negocio={data.negocio}
    categorias={data.categorias}
    mesa={data.mesa}
    {cart}
    pedidoHref="/m/{data.negocio.slug}/pedido{data.mesa ? `?mesa=${data.mesa}` : ''}"
  />
{/if}
