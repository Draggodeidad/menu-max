<script lang="ts">
  import type { PageProps } from "./$types";
  import MenuView from "#lib/components/MenuView.svelte";
  import { getCart } from "#lib/cart.svelte.js";

  let { data }: PageProps = $props();
  // `data` del layout (negocio) se fusiona con el de la página.
  const cart = getCart();
</script>

<MenuView
  negocio={data.negocio}
  categorias={data.categorias}
  mesa={data.mesa}
  {cart}
  pedidoHref="/m/{data.negocio.slug}/pedido{data.mesa ? `?mesa=${data.mesa}` : ''}"
/>
