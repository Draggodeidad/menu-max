<script lang="ts">
  import Phone from "#lib/components/Phone.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Plus from "@lucide/svelte/icons/plus";

  const demoName = "Tacos El Güero";
  let nombre = $state("");
  let negocio = $derived(nombre.trim() || demoName);

  const pasos = [
    {
      titulo: "Arma tu menú",
      texto:
        "Escribe tus platillos, precios y opciones en minutos. Sin necesidad de registrarte antes.",
    },
    {
      titulo: "Publícalo con tu QR",
      texto:
        "Descarga e imprime tu código para las mesas o pega el enlace en tus estados y perfil.",
    },
    {
      titulo: "Recibe pedidos por WhatsApp",
      texto:
        "Tus clientes te mandan su selección completa, mesa o domicilio, y el total listo para cobrar.",
    },
  ];
</script>

<svelte:head>
  <title>MenusMax · Tu menú en línea, con pedidos por WhatsApp</title>
  <meta
    name="description"
    content="Crea el menú digital de tu negocio y recibe pedidos por WhatsApp. Gratis, sin tarjeta."
  />
  <meta property="og:title" content="MenusMax · Tu menú en línea, con pedidos por WhatsApp" />
  <meta
    property="og:description"
    content="Crea el menú digital de tu negocio y recibe pedidos por WhatsApp."
  />
</svelte:head>

{#snippet agregar()}
  <span
    class="grid size-8 shrink-0 place-items-center rounded-full bg-tinta text-white"
    aria-hidden="true"
  >
    <Plus class="size-4" />
  </span>
{/snippet}

<header class="sticky top-0 z-20 border-b border-linea bg-white/80 backdrop-blur-md">
  <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
    <a href="/" class="text-xl font-bold tracking-[-0.03em]">MenusMax</a>
    <Button href="/entrar" variant="outline" class="h-11 px-5 text-sm">Entrar</Button>
  </div>
</header>

<main>
  <section
    class="border-b border-linea bg-[radial-gradient(60%_70%_at_78%_45%,color-mix(in_oklab,var(--color-nopal)_11%,transparent),transparent)]"
  >
    <div
      class="mx-auto grid max-w-6xl items-center gap-14 px-6 py-16 lg:min-h-[48rem] lg:grid-cols-[1fr_auto] lg:py-24"
    >
      <div>
        <h1
          class="max-w-[13ch] text-5xl leading-[1.02] font-bold tracking-[-0.03em] text-balance lg:text-6xl"
        >
          Tu menú en línea, con pedidos por WhatsApp.
        </h1>
        <p class="mt-6 max-w-[44ch] text-lg leading-relaxed text-piedra">
          Escribe tus productos, comparte tu QR y recibe cada pedido listo en tu WhatsApp.
        </p>

        <form
          method="GET"
          action="/crear"
          class="mt-10 flex max-w-xl flex-col gap-2 rounded-xl border border-linea bg-white p-2 shadow-[0_12px_32px_-16px_rgb(28_31_26/0.22)] transition-shadow focus-within:border-nopal/40 focus-within:ring-2 focus-within:ring-nopal/15 sm:flex-row"
        >
          <Label for="nombre" class="sr-only">Nombre de tu negocio</Label>
          <Input
            id="nombre"
            name="nombre"
            type="text"
            autocomplete="organization"
            placeholder="Nombre de tu negocio"
            bind:value={nombre}
            class="border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <Button type="submit" class="shrink-0">Crear mi menú</Button>
        </form>
        <p class="mt-4 flex items-center gap-2 text-sm text-piedra">
          <Check class="size-4 text-nopal" aria-hidden="true" />
          Gratis. Sin tarjeta.
        </p>
      </div>

      <div class="relative justify-self-center lg:justify-self-end">
        <Phone>
          <div class="px-4">
            <h2 class="truncate pt-3 text-2xl font-bold tracking-[-0.03em]">{negocio}</h2>
            <p class="mt-1 text-sm text-piedra">Abierto · Cierra 23:00</p>
          </div>

          <div class="mt-4 flex gap-2 border-y border-linea px-4 py-2.5">
            <span class="rounded-full bg-tinta px-3 py-1 text-xs font-medium text-white">Tacos</span
            >
            <span class="rounded-full border border-linea bg-white px-3 py-1 text-xs font-medium"
              >Bebidas</span
            >
          </div>

          <div class="px-4">
            <h3 class="pt-4 pb-2 text-xs font-medium text-piedra">Tacos</h3>
            <ul class="border-t border-linea">
              <li class="flex items-start justify-between gap-3 border-b border-linea py-3.5">
                <div class="min-w-0">
                  <p class="text-sm font-semibold">Pastor con piña</p>
                  <p class="mt-1 text-xs leading-snug text-piedra">
                    Al trompo con cilantro, cebolla y piña.
                  </p>
                  <p class="mt-2 text-sm font-semibold tabular-nums">$22.00</p>
                  <p class="mt-2 flex items-center gap-1 text-xs">
                    Tortilla <ChevronDown class="size-3" aria-hidden="true" />
                  </p>
                </div>
                {@render agregar()}
              </li>
              <li class="flex items-start justify-between gap-3 py-3.5">
                <div class="min-w-0">
                  <p class="text-sm font-semibold">Suadero confitado</p>
                  <p class="mt-1 text-xs leading-snug text-piedra">
                    Doble tortilla taquera y salsa verde.
                  </p>
                  <p class="mt-2 text-sm font-semibold tabular-nums">$24.00</p>
                </div>
                {@render agregar()}
              </li>
            </ul>

            <h3 class="pt-5 pb-2 text-xs font-medium text-piedra">Bebidas</h3>
            <ul class="border-t border-linea">
              <li class="flex items-start justify-between gap-3 py-3.5">
                <div class="min-w-0">
                  <p class="text-sm font-semibold">Agua de horchata (1L)</p>
                  <p class="mt-2 text-sm font-semibold tabular-nums">$35.00</p>
                </div>
                {@render agregar()}
              </li>
            </ul>
          </div>
        </Phone>

        <div
          class="mx-auto mt-6 flex w-[260px] items-center gap-3 rounded-xl border border-linea bg-white px-4 py-3 shadow-[0_16px_32px_-12px_rgb(28_31_26/0.25)] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500 motion-safe:fill-mode-backwards motion-safe:delay-700 lg:absolute lg:-left-60 lg:bottom-12 lg:mt-0"
          aria-hidden="true"
        >
          <span class="size-2.5 shrink-0 rounded-full bg-cempasuchil"></span>
          <div class="min-w-0 text-sm">
            <p class="font-semibold">Pedido nuevo · Mesa 4</p>
            <p class="text-piedra tabular-nums">3 productos · $80.00</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="bg-white py-16 lg:py-24">
    <div class="mx-auto max-w-6xl px-6">
      <h2 class="text-2xl font-semibold tracking-[-0.02em]">Cómo funciona</h2>

      <ol class="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
        {#each pasos as paso, i (paso.titulo)}
          <li class="relative border-t border-linea pt-8">
            <span
              class="absolute -top-4 left-0 grid size-8 place-items-center rounded-full bg-nopal text-sm font-semibold text-white tabular-nums"
              >{i + 1}</span
            >
            <h3 class="text-lg font-semibold tracking-[-0.02em]">{paso.titulo}</h3>
            <p class="mt-2 max-w-[44ch] text-[15px] leading-relaxed text-piedra">{paso.texto}</p>
          </li>
        {/each}
      </ol>

      <div
        class="mt-16 flex flex-col gap-4 rounded-xl border border-linea bg-cal/60 p-6 sm:flex-row sm:items-center sm:justify-between"
      >
        <p>
          <strong class="font-semibold">Precio:</strong> Gratis para comenzar. Planes completos desde
          $299 MXN al mes sin comisiones por pedido.
        </p>
        <Button href="/crear" class="shrink-0">Crear mi menú</Button>
      </div>
    </div>
  </section>
</main>

<footer class="border-t border-linea">
  <div
    class="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-sm text-piedra sm:flex-row sm:items-center sm:justify-between"
  >
    <p>© MenusMax · Menús digitales con pedidos por WhatsApp.</p>
    <nav class="flex gap-6" aria-label="Pie de página">
      <a href="/entrar" class="hover:text-tinta">Entrar</a>
      <a href="/crear" class="hover:text-tinta">Crear menú</a>
    </nav>
  </div>
</footer>
