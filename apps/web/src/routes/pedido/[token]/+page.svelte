<script lang="ts">
  import { invalidate } from "$app/navigation";
  import { MediaQuery } from "svelte/reactivity";
  import { fade } from "svelte/transition";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Phone from "@lucide/svelte/icons/phone";
  import Store from "@lucide/svelte/icons/store";
  import Banknote from "@lucide/svelte/icons/banknote";
  import MessageCircle from "@lucide/svelte/icons/message-circle";
  import type { PageProps } from "./$types";
  import { formatMoney } from "#lib/money.js";

  let { data }: PageProps = $props();
  const pedido = $derived(data.pedido);
  let actualizando = $state(false);
  let errorActualizacion = $state(false);

  async function actualizar() {
    if (actualizando) return;
    actualizando = true;
    try {
      await invalidate("app:pedido");
      errorActualizacion = false;
    } catch {
      errorActualizacion = true;
    } finally {
      actualizando = false;
    }
  }
  const reducedMotion = new MediaQuery("(prefers-reduced-motion: reduce)");
  const duration = $derived(reducedMotion.current ? 0 : 200);
  const pasos = $derived([
    { estado: "pending", label: "Recibido", descripcion: "Comanda enviada a la taquería · 14:32" },
    { estado: "accepted", label: "Aceptado", descripcion: "El negocio confirmó el pedido · 14:33" },
    {
      estado: "preparing",
      label: "En preparación",
      descripcion: "Tus tacos se están dorando al comal en este momento.",
    },
    {
      estado: "ready",
      label: pedido.modalidad === "domicilio" ? "Listo para salir" : "Listo para entrega",
      descripcion:
        pedido.modalidad === "domicilio"
          ? "Tu pedido está listo para salir."
          : "Te avisaremos para pasar a barra con tu número",
    },
    ...(pedido.modalidad === "domicilio"
      ? [{ estado: "out_for_delivery", label: "En camino", descripcion: "Tu pedido va en camino." }]
      : []),
    { estado: "delivered", label: "Entregado", descripcion: "¡Buen provecho!" },
  ]);
  const actual = $derived(
    Math.max(
      0,
      pasos.findIndex((paso) => paso.estado === pedido.estado),
    ),
  );
  const rechazado = $derived(pedido.estado === "rejected");
  const final = $derived(rechazado || pedido.estado === "delivered");
  const titulo = $derived(rechazado ? "Pedido rechazado" : pasos[actual].label);
  const modalidad = $derived(
    pedido.modalidad === "mesa"
      ? `Mesa ${pedido.mesa}`
      : pedido.modalidad === "domicilio"
        ? "A domicilio"
        : "Para recoger en sucursal",
  );

  $effect(() => {
    if (final) return;
    const id = setInterval(() => {
      void actualizar();
    }, 10_000);
    return () => clearInterval(id);
  });
</script>

<svelte:head>
  <title>Pedido #{pedido.codigo} · {pedido.negocio.nombre}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="min-h-dvh bg-cal text-tinta">
  <header class="bg-background">
    <div class="mx-auto flex max-w-md items-center justify-between gap-4 px-5 py-4">
      <span class="font-bold">{pedido.negocio.nombre}</span>
      <span class="rounded-full bg-cal px-3 py-1 text-sm font-semibold"
        >Pedido #{pedido.codigo}</span
      >
    </div>
  </header>

  <main class="mx-auto max-w-md space-y-6 px-5 py-6">
    <section
      class="rounded-xl border border-linea bg-background p-5"
      aria-label="Estado actual del pedido"
    >
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div aria-live="polite">
          <p class="text-sm font-semibold text-piedra">Estado actual</p>
          {#key titulo}<h1 in:fade={{ duration }} class="text-2xl font-bold">{titulo}</h1>{/key}
        </div>
        <div class="text-right">
          <p class="text-sm text-piedra">Total comanda</p>
          <p class="text-2xl font-bold text-nopal tabular-nums">
            {formatMoney(pedido.totalCents)} MXN
          </p>
        </div>
      </div>
      <div class="mt-4 flex flex-wrap gap-2 border-t border-linea pt-3 text-sm">
        <span class="inline-flex items-center gap-1 rounded-full bg-cal px-3 py-1 font-medium"
          ><Store aria-hidden="true" class="size-4" />{modalidad}</span
        >
        <span class="rounded-full bg-cal px-3 py-1 text-piedra">{pedido.cliente}</span>
      </div>
    </section>

    <section class="rounded-xl border border-linea bg-background p-5" aria-labelledby="progreso">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-linea pb-3">
        <h2 id="progreso" class="text-sm font-semibold text-piedra">Progreso en cocina</h2>
        {#if !final && !errorActualizacion}<span
            class="flex items-center gap-2 text-sm font-medium text-nopal"
            ><span class="size-2 rounded-full bg-nopal"></span>{actualizando
              ? "Actualizando…"
              : "Actualizando en vivo"}</span
          >{/if}
      </div>
      {#if errorActualizacion}
        <div role="alert" class="mt-4 text-sm text-piedra">
          <p>No se pudo actualizar el pedido. Inténtalo de nuevo.</p>
          <button
            type="button"
            onclick={actualizar}
            disabled={actualizando}
            class="min-h-11 font-semibold text-nopal underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal disabled:opacity-50"
            >{actualizando ? "Actualizando…" : "Reintentar"}</button
          >
        </div>
      {/if}
      {#if rechazado}
        <p class="mt-4 font-semibold">El negocio no pudo aceptar tu pedido</p>
        <p class="mt-1 text-sm text-piedra">{pedido.motivoRechazo} No se te cobrará nada.</p>
      {:else}
        {#if pedido.retraso}<p class="mt-4 text-sm text-piedra">
            Tu pedido tarda más de lo normal. Llama al negocio si necesitas ayuda.
          </p>{/if}
        <ol class="mt-4">
          {#each pasos as paso, i (paso.estado)}
            {@const hecho = i < actual}
            {@const ahora = i === actual}
            <li
              class="relative flex gap-4 pb-5 last:pb-0"
              aria-current={ahora ? "step" : undefined}
            >
              {#if i < pasos.length - 1}<span
                  aria-hidden="true"
                  class="absolute top-3 bottom-0 left-1 w-px {hecho ? 'bg-nopal' : 'bg-linea'}"
                ></span>{/if}
              <span
                aria-hidden="true"
                class="relative mt-1 size-3 shrink-0 rounded-full {hecho || ahora
                  ? 'bg-nopal'
                  : 'bg-linea'}"
              ></span>
              <div class="min-w-0 flex-1">
                <p class="font-semibold {i > actual ? 'text-piedra' : ''}">
                  {paso.label}
                  {#if ahora}<span
                      class="ml-1 rounded-full bg-cal px-2 py-1 text-sm font-medium text-nopal"
                      >Actual</span
                    >{/if}
                </p>
                <p class="mt-1 text-sm {ahora ? 'text-nopal' : 'text-piedra'}">
                  {paso.descripcion}
                </p>
              </div>
              {#if hecho}<Check aria-hidden="true" class="size-5 shrink-0 text-nopal" />{/if}
            </li>
          {/each}
        </ol>
      {/if}
    </section>

    {#if !rechazado}
      <section
        class="rounded-xl border border-linea bg-background p-5"
        aria-labelledby="whatsapp-titulo"
      >
        <h2 id="whatsapp-titulo" class="font-semibold">Avisa al negocio por WhatsApp</h2>
        {#if data.whatsappHref}
          <p class="mt-1 text-sm text-piedra">
            Se abrirá WhatsApp con tu pedido escrito. Tú decides si envías el mensaje; tu pedido ya
            quedó registrado y el seguimiento sigue aquí.
          </p>
          <a
            href={data.whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            class="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-nopal px-4 font-semibold text-white hover:bg-nopal/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal"
            ><MessageCircle aria-hidden="true" class="size-5" />Abrir WhatsApp con mi pedido<span
              class="sr-only"
            >
              (se abre en otra pestaña)</span
            ></a
          >
        {:else}
          <p class="mt-1 text-sm text-piedra">
            Este negocio no tiene un número de WhatsApp disponible. Puedes seguir tu pedido aquí o
            llamar al negocio.
          </p>
        {/if}
      </section>
    {/if}

    <details open class="group rounded-xl border border-linea bg-background p-5">
      <summary
        class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal"
      >
        <span>Detalle de tu orden ({pedido.lineas.length} platillos)</span>
        <ChevronDown aria-hidden="true" class="size-4 shrink-0 group-open:rotate-180" />
      </summary>
      {#if pedido.lineas.length}
        <ul class="divide-y divide-linea border-t border-linea">
          {#each pedido.lineas as linea (linea.id)}
            <li class="flex items-center justify-between gap-4 py-3">
              <div>
                <p class="font-semibold">{linea.cantidad}× {linea.nombre}</p>
                <p class="text-sm text-piedra">{linea.descripcion}</p>
              </div>
              <span class="font-semibold tabular-nums">{formatMoney(linea.totalCents)}</span>
            </li>
          {/each}
        </ul>
      {:else}<p class="border-t border-linea py-4 text-sm text-piedra">
          No hay productos en el detalle de este pedido. Llama al negocio para aclararlo.
        </p>{/if}
      <div
        class="flex flex-wrap items-center justify-between gap-2 border-t border-linea pt-3 text-sm"
      >
        <span class="text-piedra">Método de liquidación:</span><span
          class="inline-flex items-center gap-1 font-semibold"
          ><Banknote aria-hidden="true" class="size-4" />Efectivo al recibir</span
        >
      </div>
    </details>
    <footer class="pb-8 text-center text-sm text-piedra">
      <p>¿Necesitas hacer una aclaración o agregar algo?</p>
      <a
        href="tel:{pedido.negocio.telefono}"
        class="inline-flex min-h-11 items-center gap-1 font-semibold text-nopal underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal"
        ><Phone aria-hidden="true" class="size-4" />Llamar a {pedido.negocio.nombre} (55 1234 5678)</a
      >
    </footer>
  </main>
</div>
