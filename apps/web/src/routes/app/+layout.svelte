<script lang="ts">
  import { navigating, page } from "$app/state";
  import Bell from "@lucide/svelte/icons/bell";
  import BookOpen from "@lucide/svelte/icons/book-open";
  import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
  import ReceiptText from "@lucide/svelte/icons/receipt-text";
  import Settings from "@lucide/svelte/icons/settings";
  import SquareArrowOutUpRight from "@lucide/svelte/icons/square-arrow-out-up-right";
  import User from "@lucide/svelte/icons/user";
  import UtensilsCrossed from "@lucide/svelte/icons/utensils-crossed";
  import type { LayoutProps } from "./$types";
  import CatalogoSkeleton from "./catalogo/CatalogoSkeleton.svelte";
  import AjustesSkeleton from "./ajustes/AjustesSkeleton.svelte";
  import PedidosSkeleton from "./PedidosSkeleton.svelte";

  let { data, children }: LayoutProps = $props();

  const navegacion = [
    { href: "/app", label: "Pedidos", icon: ReceiptText },
    { href: "/app/catalogo", label: "Menú", icon: BookOpen },
    { href: "/app/ajustes", label: "Ajustes", icon: Settings },
  ];

  const esActual = (href: string) =>
    href === "/app" ? page.url.pathname === "/app" : page.url.pathname.startsWith(href);

  const focoRing =
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal";
</script>

{#snippet marca()}
  <a
    href="/app"
    class="flex min-h-11 items-center gap-2 rounded-lg text-xl font-bold tracking-[-0.03em] {focoRing}"
  >
    <UtensilsCrossed class="size-6 text-nopal" aria-hidden="true" />
    MenusMax
  </a>
{/snippet}

<aside
  class="fixed inset-y-0 left-0 hidden w-56 flex-col print:!hidden gap-4 border-r border-linea bg-white p-4 lg:flex"
>
  {@render marca()}

  <div class="relative">
    <label class="sr-only" for="sucursal">Sucursal</label>
    <span
      class="pointer-events-none absolute top-1/2 left-3 size-2 -translate-y-1/2 rounded-full {data
        .negocio.abierto
        ? 'bg-nopal'
        : 'bg-piedra'}"
      aria-hidden="true"
    ></span>
    <!-- TEMPORAL: una sola sucursal en el MVP; la lista vendrá con la sesión. -->
    <select
      id="sucursal"
      class="h-11 w-full appearance-none rounded-lg border border-linea bg-white pr-9 pl-8 text-sm font-medium text-tinta outline-none focus-visible:border-nopal focus-visible:ring-2 focus-visible:ring-nopal/20"
    >
      <option>{data.negocio.sucursal}</option>
    </select>
    <ChevronsUpDown
      class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-piedra"
      aria-hidden="true"
    />
  </div>

  <nav aria-label="Navegación del panel">
    <ul class="grid gap-1">
      {#each navegacion as item (item.href)}
        {@const actual = esActual(item.href)}
        <li>
          <a
            href={item.href}
            aria-current={actual ? "page" : undefined}
            class="flex min-h-11 items-center gap-3 rounded-lg px-3 text-base transition-colors {focoRing} {actual
              ? 'bg-cal font-semibold text-nopal'
              : 'text-tinta hover:bg-cal'}"
          >
            <item.icon class="size-5" aria-hidden="true" />
            {item.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>

  <a
    href="/m/{data.negocio.slug}"
    target="_blank"
    rel="noopener"
    class="mt-auto flex min-h-11 items-center gap-2 rounded-lg border border-linea bg-white px-3 text-sm font-medium text-tinta transition-colors hover:bg-cal {focoRing}"
  >
    <SquareArrowOutUpRight class="size-4" aria-hidden="true" />
    Ver menú público
    <span class="sr-only">(se abre en una pestaña nueva)</span>
  </a>
</aside>

<div class="min-h-dvh pb-16 lg:pb-0 lg:pl-56 print:pl-0">
  <header
    class="sticky top-0 z-10 flex min-h-16 print:hidden items-center justify-between gap-3 border-b border-linea bg-white px-4 sm:px-6"
  >
    <div class="flex min-w-0 items-center gap-3">
      <p class="flex min-w-0 items-center gap-2 text-sm text-piedra">
        <span
          class="size-2 shrink-0 rounded-full {data.negocio.abierto ? 'bg-nopal' : 'bg-piedra'}"
          aria-hidden="true"
        ></span>
        <span class="leading-tight"
          >{data.negocio.abierto ? "En línea para pedidos" : "Cerrado para pedidos"}</span
        >
      </p>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <a
        href="/app#nuevos"
        aria-label={data.nuevos === 0
          ? "Sin pedidos nuevos"
          : data.nuevos === 1
            ? "1 pedido nuevo"
            : `${data.nuevos} pedidos nuevos`}
        class="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-linea bg-white px-3 text-sm font-semibold tabular-nums transition-colors hover:bg-cal {focoRing}"
      >
        <Bell class="size-4" aria-hidden="true" />
        {data.nuevos}
      </a>
      <a
        href="/app/ajustes"
        aria-label="Cuenta y ajustes"
        class="grid size-11 place-items-center rounded-full bg-nopal text-white transition-colors hover:bg-nopal/90 {focoRing}"
      >
        <User class="size-5" aria-hidden="true" />
      </a>
      <a
        href="/m/{data.negocio.slug}"
        target="_blank"
        rel="noopener"
        aria-label="Ver menú público (se abre en una pestaña nueva)"
        class="grid size-11 place-items-center rounded-lg border border-linea bg-white text-tinta transition-colors hover:bg-cal lg:hidden {focoRing}"
      >
        <SquareArrowOutUpRight class="size-4" aria-hidden="true" />
      </a>
    </div>
  </header>

  {#if navigating.to?.route.id === "/app"}
    <PedidosSkeleton />
  {:else if navigating.to?.route.id === "/app/catalogo"}
    <CatalogoSkeleton />
  {:else if navigating.to?.route.id === "/app/ajustes"}
    <AjustesSkeleton />
  {:else}
    {@render children()}
  {/if}
</div>

<nav
  aria-label="Navegación del panel"
  class="fixed inset-x-0 bottom-0 z-10 border-t border-linea bg-white lg:hidden print:hidden"
>
  <ul class="grid grid-cols-3">
    {#each navegacion as item (item.href)}
      {@const actual = esActual(item.href)}
      <li>
        <a
          href={item.href}
          aria-current={actual ? "page" : undefined}
          class="flex min-h-16 flex-col items-center justify-center gap-1 text-sm {focoRing} {actual
            ? 'font-semibold text-nopal'
            : 'text-piedra'}"
        >
          <item.icon class="size-5" aria-hidden="true" />
          {item.label}
        </a>
      </li>
    {/each}
  </ul>
</nav>
