<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
  let mensaje = $state("");

  async function copiarEnlace() {
    try {
      await navigator.clipboard.writeText(data.enlace);
      mensaje = "Enlace copiado.";
    } catch {
      mensaje = "No se pudo copiar. Selecciona el enlace y cópialo manualmente.";
    }
  }
</script>

<svelte:head>
  <title>Tu menú está publicado · MenusMax</title>
  <meta name="description" content="Comparte tu menú y haz un pedido de prueba." />
</svelte:head>

<main
  class="mx-auto flex w-full max-w-md flex-col items-center px-4 pt-16 pb-20 text-center sm:px-0 lg:pt-38"
>
  <p class="mb-3 text-sm text-piedra">Vista de ejemplo</p>
  <h1 class="text-3xl font-bold tracking-[-0.03em]">Tu menú está publicado.</h1>
  <p class="mt-2 text-sm text-piedra">Ya puedes recibir pedidos directo a tu WhatsApp.</p>

  <div
    class="mt-6 grid size-64 max-w-full place-items-center rounded-xl border border-linea bg-white p-6"
  >
    <svg
      viewBox="-4 -4 {data.qr.size + 8} {data.qr.size + 8}"
      class="size-full text-tinta"
      role="img"
      aria-label="Código QR para abrir el menú"
    >
      <rect x="-4" y="-4" width={data.qr.size + 8} height={data.qr.size + 8} fill="white" />
      {#each data.qr.modules as modulo, i (i)}
        {#if modulo}
          <rect
            x={i % data.qr.size}
            y={Math.floor(i / data.qr.size)}
            width="1"
            height="1"
            fill="currentColor"
          />
        {/if}
      {/each}
    </svg>
  </div>

  <a
    href={data.enlace}
    class="mt-7 max-w-full break-all rounded-sm text-sm text-piedra underline-offset-4 hover:text-tinta hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal"
    >{data.enlace.replace(/^https?:\/\//, "")}</a
  >

  <div class="mt-8 grid w-full gap-3">
    <Button href={data.enlace} class="w-full">Hacer un pedido de prueba</Button>
    <Button href={data.descarga} download="menu-qr.svg" variant="outline" class="w-full"
      >Descargar QR</Button
    >
    <Button type="button" variant="outline" class="w-full" onclick={copiarEnlace}
      >Copiar enlace</Button
    >
  </div>
  <p class="mt-2 min-h-5 text-sm text-piedra" aria-live="polite">{mensaje}</p>
  <a
    href="/app/catalogo"
    class="mt-3 inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-nopal hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal"
    >Agregar fotos a tus productos</a
  >
</main>
