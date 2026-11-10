<script lang="ts">
  import Phone from "#lib/components/Phone.svelte";

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
    class="grid size-8 shrink-0 place-items-center rounded-full bg-piedra/60 text-white"
    aria-hidden="true"
  >
    <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M8 3v10M3 8h10" stroke-linecap="round" />
    </svg>
  </span>
{/snippet}

<header class="border-b border-linea bg-white">
  <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
    <a href="/" class="text-xl font-bold tracking-[-0.03em]">MenusMax</a>
    <a
      href="/entrar"
      class="inline-flex h-11 items-center rounded-lg border border-linea bg-white px-5 text-sm font-medium hover:bg-cal"
    >
      Entrar
    </a>
  </div>
</header>

<main>
  <section class="border-b border-linea">
    <div
      class="mx-auto grid min-h-[calc(100svh-4rem)] max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-[1fr_auto] lg:py-24"
    >
      <div>
        <h1
          class="max-w-[12ch] text-5xl leading-[1.02] font-bold tracking-[-0.03em] text-balance lg:text-6xl"
        >
          Tu menú en línea, con pedidos por WhatsApp.
        </h1>

        <form method="GET" action="/crear" class="mt-10 flex max-w-lg flex-col gap-3 sm:flex-row">
          <label for="nombre" class="sr-only">Nombre de tu negocio</label>
          <input
            id="nombre"
            name="nombre"
            type="text"
            autocomplete="organization"
            placeholder="Nombre de tu negocio"
            bind:value={nombre}
            class="h-12 w-full rounded-lg border border-linea bg-white px-4 text-tinta outline-none placeholder:text-piedra focus:border-nopal focus:ring-2 focus:ring-nopal/20"
          />
          <button
            type="submit"
            class="h-12 shrink-0 rounded-lg bg-nopal px-5 font-semibold text-white hover:bg-nopal/90 disabled:opacity-50"
          >
            Crear mi menú
          </button>
        </form>
        <p class="mt-4 text-sm text-piedra">Gratis. Sin tarjeta.</p>
      </div>

      <div class="justify-self-center lg:justify-self-end">
        <Phone>
          <div class="px-4">
            <h2 class="truncate pt-3 text-2xl font-bold tracking-[-0.03em]">{negocio}</h2>
            <p class="mt-1 text-sm text-piedra">Abierto · Cierra 23:00</p>
          </div>

          <div class="mt-4 flex gap-2 border-y border-linea px-4 py-2.5">
            <span class="rounded-full border border-linea bg-cal px-3 py-1 text-xs font-medium"
              >Tacos</span
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
                  <p class="mt-2 text-xs text-tinta">Tortilla ▾</p>
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
      </div>
    </div>
  </section>

  <section class="bg-white py-16 lg:py-24">
    <div class="mx-auto max-w-6xl px-6">
      <h2 class="text-xl font-semibold tracking-[-0.02em]">Cómo funciona</h2>

      <ol class="mt-10 grid gap-8 md:grid-cols-3">
        {#each pasos as paso, i (paso.titulo)}
          <li class="border-l-2 border-linea py-1 pl-5">
            <p class="font-semibold text-nopal">{i + 1}</p>
            <h3 class="mt-3 text-lg font-semibold tracking-[-0.02em]">{paso.titulo}</h3>
            <p class="mt-2 max-w-[60ch] text-piedra">{paso.texto}</p>
          </li>
        {/each}
      </ol>

      <div
        class="mt-16 flex flex-col gap-3 border-t border-linea pt-8 sm:flex-row sm:items-center sm:justify-between"
      >
        <p>
          <strong class="font-semibold">Precio:</strong> Gratis para comenzar. Planes completos desde
          $299 MXN al mes sin comisiones por pedido.
        </p>
        <a href="/crear" class="font-semibold text-nopal hover:underline">Crear mi menú</a>
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
