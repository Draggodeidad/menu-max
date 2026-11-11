<script lang="ts">
  import { invalidate } from "$app/navigation";
  import { MediaQuery } from "svelte/reactivity";
  import { fly } from "svelte/transition";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import type { PageProps } from "./$types";
  import OrderCard, { type ResultadoPedido } from "#lib/components/OrderCard.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { formatMoney } from "#lib/money.js";
  import type { PedidoPanel } from "#lib/server/demo.js";

  let { data, form }: PageProps = $props();

  const reducedMotion = new MediaQuery("(prefers-reduced-motion: reduce)");
  const duration = $derived(reducedMotion.current ? 0 : 200);

  const nuevos = $derived(data.pedidos.filter((p) => p.estado === "pending"));
  const enCocina = $derived(
    data.pedidos.filter((p) => p.estado === "accepted" || p.estado === "preparing"),
  );
  const listos = $derived(
    data.pedidos.filter((p) => p.estado === "ready" || p.estado === "out_for_delivery"),
  );

  const CANAL = { mesa: "Mesa", recoger: "Recoger", domicilio: "Domicilio" } as const;
  const resumen = $derived([
    {
      etiqueta: "Activos ahora",
      valor: `${data.resumen.activos} ${data.resumen.activos === 1 ? "pedido" : "pedidos"}`,
    },
    { etiqueta: "Tiempo prom. cocina", valor: `${data.resumen.tiempoCocinaMin} min` },
    { etiqueta: "Venta acumulada hoy", valor: formatMoney(data.resumen.ventaHoyCents) },
    { etiqueta: "Canal predominante", valor: data.resumen.canal ? CANAL[data.resumen.canal] : "—" },
  ]);

  const mensaje = $derived(form?.ok && "mensaje" in form ? form.mensaje : "");
  const resultadoDe = (id: string): ResultadoPedido | undefined =>
    form && form.id === id ? form : undefined;

  let actualizando = $state(false);
  async function actualizar() {
    actualizando = true;
    try {
      await invalidate("app:pedidos");
    } finally {
      actualizando = false;
    }
  }

  // Polling cada 10 s (DESIGN.md §7.1-D); se detiene mientras la pestaña está oculta.
  $effect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void invalidate("app:pedidos");
    }, 10_000);
    return () => clearInterval(id);
  });

  const focoRing =
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal";
</script>

<svelte:head>
  <title>Pedidos · MenusMax</title>
</svelte:head>

{#snippet seccion(
  id: string,
  titulo: string,
  descripcion: string,
  lista: PedidoPanel[],
  vacio: string,
  alerta: boolean,
)}
  <section {id} aria-labelledby="{id}-titulo" class="mt-10 scroll-mt-24">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 id="{id}-titulo" class="text-xl font-semibold tracking-[-0.02em]">{titulo}</h2>
      <span
        class="inline-grid min-w-7 place-items-center rounded-full px-2 py-0.5 text-sm font-semibold tabular-nums {alerta &&
        lista.length > 0
          ? 'bg-cempasuchil text-tinta'
          : 'border border-linea bg-white text-tinta'}"
      >
        {lista.length}
        <span class="sr-only">{lista.length === 1 ? "pedido" : "pedidos"}</span>
      </span>
      <p class="text-sm text-piedra">{descripcion}</p>
    </div>

    {#if lista.length === 0}
      <p class="mt-4 rounded-xl border border-dashed border-linea px-4 py-6 text-sm text-piedra">
        {vacio}
      </p>
    {:else}
      <ul class="mt-4 grid gap-4 md:grid-cols-2">
        {#each lista as pedido (pedido.id)}
          <li in:fly={{ y: -8, duration }}>
            <OrderCard {pedido} resultado={resultadoDe(pedido.id)} />
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/snippet}

<main class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
  <div
    class="flex flex-col gap-4 border-b border-linea pb-6 sm:flex-row sm:items-start sm:justify-between"
  >
    <div>
      <h1 class="text-3xl font-bold tracking-[-0.03em]">Pedidos</h1>
      <p class="mt-1 text-base text-piedra">
        Gestión en tiempo real de comandas de cocina y despacho.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <p
        class="inline-flex min-h-11 items-center gap-2 rounded-full border border-linea bg-white px-4 text-sm font-medium"
      >
        <span class="size-2 rounded-full bg-nopal" aria-hidden="true"></span>
        En vivo · cada 10 s
      </p>
      <button
        type="button"
        onclick={actualizar}
        disabled={actualizando}
        aria-label="Actualizar pedidos"
        class="grid size-11 place-items-center rounded-full border border-linea bg-white text-tinta transition-colors hover:bg-cal disabled:opacity-50 {focoRing}"
      >
        <RotateCw
          class="size-4 {actualizando ? 'motion-safe:animate-spin' : ''}"
          aria-hidden="true"
        />
      </button>
    </div>
  </div>

  <p
    class={mensaje
      ? "mt-4 flex min-h-6 items-center gap-2 text-sm font-medium text-nopal"
      : "sr-only"}
    role="status"
  >
    {#if mensaje}
      <CircleCheck class="size-4" aria-hidden="true" />
      {mensaje}
    {/if}
  </p>

  {#if data.error}
    <div role="alert" class="mt-6 rounded-xl border border-error bg-white p-6">
      <h2 class="text-xl font-semibold tracking-[-0.02em]">No pudimos cargar los pedidos</h2>
      <p class="mt-1 text-base text-piedra">Revisa tu conexión y vuelve a intentarlo.</p>
      <Button class="mt-4" onclick={actualizar} disabled={actualizando}>
        {actualizando ? "Reintentando…" : "Reintentar"}
      </Button>
    </div>
  {:else}
    <dl
      class="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-linea bg-linea lg:grid-cols-4"
    >
      {#each resumen as dato (dato.etiqueta)}
        <div class="bg-white px-4 py-3">
          <dt class="text-sm text-piedra">{dato.etiqueta}</dt>
          <dd class="mt-0.5 text-lg font-semibold tabular-nums">{dato.valor}</dd>
        </div>
      {/each}
    </dl>

    {#if data.pedidos.length === 0}
      <section class="mt-10 rounded-xl border border-dashed border-linea bg-white p-8 text-center">
        <h2 class="text-xl font-semibold tracking-[-0.02em]">Aún no hay pedidos</h2>
        <p class="mx-auto mt-1 max-w-prose text-base text-piedra">
          Comparte tu QR para recibir el primero.
        </p>
        <Button href="/app/listo" variant="outline" class="mt-5">Ver mi QR</Button>
      </section>
    {:else}
      {@render seccion(
        "nuevos",
        "Nuevos",
        "Requiere aceptación inmediata",
        nuevos,
        "No hay pedidos nuevos por ahora.",
        true,
      )}
      {@render seccion(
        "en-cocina",
        "En cocina",
        "En preparación en plancha y barra",
        enCocina,
        "No hay pedidos en cocina.",
        false,
      )}
      {@render seccion(
        "listos",
        "Listos",
        "Empacados para entrega o despacho inmediato",
        listos,
        "No hay pedidos listos para entregar.",
        false,
      )}
    {/if}
  {/if}
</main>
