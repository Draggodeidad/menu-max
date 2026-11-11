<script lang="ts">
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import Clock from "@lucide/svelte/icons/clock";
  import Palette from "@lucide/svelte/icons/palette";
  import QrCode from "@lucide/svelte/icons/qr-code";
  import Send from "@lucide/svelte/icons/send";
  import Users from "@lucide/svelte/icons/users";
  import { Button } from "#lib/components/ui/button/index.js";
  import SeccionEquipo from "./SeccionEquipo.svelte";
  import SeccionQr from "./SeccionQr.svelte";
  import SeccionServicio from "./SeccionServicio.svelte";
  import SeccionTema from "./SeccionTema.svelte";
  import SeccionZonas from "./SeccionZonas.svelte";
  import type { PageProps } from "./$types";

  let { data, form }: PageProps = $props();

  const secciones = [
    {
      id: "tema",
      label: "Tema y colores",
      titulo: "Tema y colores de la carta digital",
      icon: Palette,
    },
    {
      id: "servicio",
      label: "Modalidades y horarios",
      titulo: "Modalidades de servicio y horarios",
      icon: Clock,
    },
    { id: "zonas", label: "Zonas de entrega", titulo: "Zonas y tarifas de reparto", icon: Send },
    { id: "equipo", label: "Equipo y accesos", titulo: "Equipo y accesos", icon: Users },
    { id: "qr", label: "Códigos QR por mesa", titulo: "Códigos QR por mesa", icon: QrCode },
  ];

  let activa = $state("tema");

  // Marca en la navegación la sección que se está leyendo (API del navegador).
  $effect(() => {
    if (data.error) return;
    const observer = new IntersectionObserver(
      (entradas) => {
        const visible = entradas.find((e) => e.isIntersecting);
        if (visible) activa = visible.target.id;
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    for (const s of secciones) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  });

  const focoRing =
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal";
</script>

<svelte:head>
  <title>Ajustes · MenusMax</title>
</svelte:head>

<main class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
  <header class="max-w-prose">
    <h1 class="text-3xl font-bold tracking-[-0.03em]">Ajustes</h1>
    <p class="mt-2 text-base leading-relaxed text-piedra">
      Personaliza la apariencia de tu menú, zonas de reparto, horarios y códigos QR.
    </p>
  </header>

  {#if data.error}
    <section
      class="mt-8 max-w-xl rounded-xl border border-linea bg-white p-6"
      aria-labelledby="error-titulo"
    >
      <h2 id="error-titulo" class="text-xl font-semibold tracking-[-0.02em]">
        No pudimos cargar tus ajustes
      </h2>
      <p class="mt-2 text-base leading-relaxed text-piedra">
        Revisa tu conexión e inténtalo de nuevo. Tus cambios guardados no se pierden.
      </p>
      <Button href="/app/ajustes" class="mt-5">Reintentar</Button>
    </section>
  {:else}
    <div class="mt-6 lg:mt-8 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8">
      <div class="print:hidden">
        <nav
          aria-label="Secciones de ajustes"
          class="sticky top-16 z-[5] -mx-4 flex gap-2 overflow-x-auto bg-cal px-4 py-3 sm:-mx-6 sm:px-6 lg:top-24 lg:mx-0 lg:flex-col lg:gap-1 lg:rounded-xl lg:border lg:border-linea lg:bg-white lg:p-2"
        >
          {#each secciones as s (s.id)}
            {@const actual = activa === s.id}
            <a
              href="#{s.id}"
              aria-current={actual ? "location" : undefined}
              onclick={() => (activa = s.id)}
              class="flex min-h-11 shrink-0 items-center gap-3 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors lg:rounded-lg lg:border-transparent {focoRing} {actual
                ? 'border-nopal bg-nopal text-white lg:bg-cal lg:font-semibold lg:text-nopal'
                : 'border-linea bg-white text-tinta hover:bg-cal'}"
            >
              <s.icon class="size-4 shrink-0" aria-hidden="true" />
              {s.label}
            </a>
          {/each}
        </nav>
        <p
          class="mt-4 hidden gap-2 rounded-xl bg-white p-4 text-sm leading-relaxed text-piedra lg:flex"
        >
          <CircleCheck class="mt-0.5 size-4 shrink-0 text-nopal" aria-hidden="true" />
          <span>
            <span class="block font-semibold text-nopal"
              >Menú activo: {data.ajustes.versionMenu}</span
            >
            Los cambios en colores, stock o mesas aplican al escanear los QR sin reimpresión.
          </span>
        </p>
      </div>

      <div class="min-w-0">
        {#each secciones as s, i (s.id)}
          <section
            id={s.id}
            aria-labelledby="{s.id}-titulo"
            class="scroll-mt-32 lg:scroll-mt-24 {i > 0 ? 'mt-12' : ''} {s.id === 'qr'
              ? ''
              : 'print:hidden'}"
          >
            <h2
              id="{s.id}-titulo"
              class="border-b border-linea pb-3 text-xl font-semibold tracking-[-0.02em]"
            >
              {s.titulo}
            </h2>
            <div class="mt-4">
              {#if s.id === "tema"}
                <SeccionTema
                  datos={data}
                  {form}
                  negocio={data.negocio}
                  categorias={data.categorias}
                />
              {:else if s.id === "servicio"}
                <SeccionServicio datos={data} {form} />
              {:else if s.id === "zonas"}
                <SeccionZonas datos={data} {form} />
              {:else if s.id === "equipo"}
                <SeccionEquipo datos={data} {form} />
              {:else}
                <SeccionQr datos={data} {form} />
              {/if}
            </div>
          </section>
        {/each}
      </div>
    </div>
  {/if}
</main>
