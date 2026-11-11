<script lang="ts">
  let { children } = $props();
</script>

<header class="border-b border-linea bg-white">
  <div
    class="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-6 px-4 sm:px-6"
  >
    <a
      href="/"
      class="rounded-sm py-3 text-xl font-bold tracking-[-0.03em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal"
      >MenusMax</a
    >
    <nav
      aria-label="Navegación del panel"
      class="flex items-center gap-4 text-sm text-piedra sm:gap-6"
    >
      <a
        href="/app"
        class="flex min-h-11 items-center rounded-sm hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal"
        >Pedidos</a
      >
      <a
        href="/app/catalogo"
        class="flex min-h-11 items-center rounded-sm hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal"
        >Menú</a
      >
      <a
        href="/app/ajustes"
        class="flex min-h-11 items-center rounded-sm hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal"
        >Ajustes</a
      >
    </nav>
  </div>
</header>

{@render children()}
