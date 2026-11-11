<script lang="ts" module>
  import type { EstadoPanel, Modalidad, PedidoPanel } from "#lib/server/demo.js";

  /** Resultado de una form action del panel para este pedido (el padre lo filtra por id). */
  export type ResultadoPedido = {
    ok: boolean;
    id: string;
    error?: string;
    fieldErrors?: { motivo?: string };
    values?: { motivo?: string };
  };

  const MODALIDAD: Record<Modalidad, string> = {
    mesa: "Mesa",
    recoger: "Para recoger",
    domicilio: "A domicilio",
  };

  // Nombre del botón principal por estado (DESIGN.md §7.1) y su texto mientras se envía (§6).
  function accion(estado: EstadoPanel, modalidad: Modalidad) {
    switch (estado) {
      case "pending":
        return { label: "Aceptar", enviando: "Aceptando…" };
      case "accepted":
        return { label: "Empezar a preparar", enviando: "Empezando…" };
      case "preparing":
        return { label: "Marcar listo", enviando: "Marcando…" };
      case "ready":
        return modalidad === "domicilio"
          ? { label: "Enviar a domicilio", enviando: "Enviando…" }
          : { label: "Entregado", enviando: "Entregando…" };
      case "out_for_delivery":
        return { label: "Entregado", enviando: "Entregando…" };
    }
  }

  function etiquetaEstado(estado: EstadoPanel, modalidad: Modalidad) {
    switch (estado) {
      case "pending":
        return "Por aceptar";
      case "accepted":
        return "Aceptado";
      case "preparing":
        return "Preparando";
      case "ready":
        return modalidad === "domicilio"
          ? "Listo para envío"
          : modalidad === "mesa"
            ? "Listo para servir"
            : "Listo para recoger";
      case "out_for_delivery":
        return "En camino";
    }
  }
</script>

<script lang="ts">
  import { enhance } from "$app/forms";
  import Bike from "@lucide/svelte/icons/bike";
  import Check from "@lucide/svelte/icons/check";
  import CheckCheck from "@lucide/svelte/icons/check-check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import Clock from "@lucide/svelte/icons/clock";
  import CookingPot from "@lucide/svelte/icons/cooking-pot";
  import Navigation from "@lucide/svelte/icons/navigation";
  import Phone from "@lucide/svelte/icons/phone";
  import StickyNote from "@lucide/svelte/icons/sticky-note";
  import Truck from "@lucide/svelte/icons/truck";
  import User from "@lucide/svelte/icons/user";
  import { Button } from "#lib/components/ui/button/index.js";
  import { formatMoney } from "#lib/money.js";

  let { pedido, resultado }: { pedido: PedidoPanel; resultado?: ResultadoPedido } = $props();

  let enviando = $state<"avanzar" | "rechazar" | null>(null);

  const principal = $derived(accion(pedido.estado, pedido.modalidad));
  const pendiente = $derived(pedido.estado === "pending");
  const despachando = $derived(pedido.estado === "ready" || pedido.estado === "out_for_delivery");
  const modalidad = $derived(
    pedido.modalidad === "mesa" ? `Mesa ${pedido.mesa ?? ""}`.trim() : MODALIDAD[pedido.modalidad],
  );
  const totalEtiqueta = $derived(
    despachando
      ? "Total a cobrar:"
      : pedido.tarifaEntregaCents !== undefined
        ? "Total (incluye envío):"
        : "Total comanda:",
  );
  const errorMotivo = $derived(resultado?.fieldErrors?.motivo);
  const idTitulo = $derived(`pedido-${pedido.id}`);
  const idMotivo = $derived(`motivo-${pedido.id}`);
  const idErrorMotivo = $derived(`motivo-error-${pedido.id}`);
</script>

<article
  aria-labelledby={idTitulo}
  aria-busy={enviando !== null}
  class="flex h-full flex-col gap-4 rounded-xl border bg-white p-5 {pendiente
    ? 'border-cempasuchil'
    : 'border-linea'}"
>
  <header class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
    <div>
      <div class="flex flex-wrap items-center gap-2">
        <h3 id={idTitulo} class="text-xl font-semibold tracking-[-0.02em] tabular-nums">
          #{pedido.codigo}
        </h3>
        <span
          class="rounded-full border border-linea bg-cal px-2.5 py-0.5 text-xs font-medium text-tinta"
          >{modalidad}</span
        >
      </div>
      <p class="mt-1 flex items-center gap-1.5 text-sm text-piedra">
        <Clock class="size-4" aria-hidden="true" />
        hace {pedido.haceMin} min
      </p>
    </div>
    <p
      class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium {pendiente ||
      pedido.estado === 'accepted'
        ? 'border border-linea bg-cal text-tinta'
        : 'bg-nopal/10 text-nopal'}"
    >
      {#if pedido.estado === "preparing"}
        <CookingPot class="size-3.5" aria-hidden="true" />
      {:else if despachando}
        {#if pedido.estado === "out_for_delivery"}
          <Bike class="size-3.5" aria-hidden="true" />
        {:else}
          <Check class="size-3.5" aria-hidden="true" />
        {/if}
      {:else}
        <span class="size-1.5 rounded-full bg-tinta" aria-hidden="true"></span>
      {/if}
      {etiquetaEstado(pedido.estado, pedido.modalidad)}
    </p>
  </header>

  <div
    class="flex flex-wrap items-center justify-between gap-x-3 rounded-lg border border-linea bg-cal px-3"
  >
    <p class="flex min-h-11 min-w-0 items-center gap-2 font-medium">
      <User class="size-4 shrink-0 text-piedra" aria-hidden="true" />
      <span class="truncate">{pedido.cliente.nombre}</span>
    </p>
    <a
      href="tel:{pedido.cliente.telefono.replaceAll(' ', '')}"
      class="inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm text-nopal tabular-nums hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal"
    >
      <Phone class="size-4" aria-hidden="true" />
      <span class="sr-only">Llamar a {pedido.cliente.nombre}:</span>
      {pedido.cliente.telefono}
    </a>
  </div>

  {#if pedido.direccion}
    <div class="flex items-start gap-2.5 rounded-lg border border-linea bg-cal px-3 py-2.5">
      {#if despachando}
        <Navigation class="mt-0.5 size-4 shrink-0 text-nopal" aria-hidden="true" />
      {:else}
        <Truck class="mt-0.5 size-4 shrink-0 text-nopal" aria-hidden="true" />
      {/if}
      <p class="text-sm">
        <span class="block text-piedra">{despachando ? "Destino de entrega:" : "Entrega en:"}</span>
        <span class="font-medium">{pedido.direccion}</span>
      </p>
    </div>
  {/if}

  {#if !despachando}
    <ul class="grid gap-2 border-t border-linea pt-4">
      {#each pedido.lineas as linea (linea.id)}
        <li class="flex items-baseline gap-2">
          <span class="w-7 shrink-0 font-semibold text-nopal tabular-nums">{linea.cantidad}x</span>
          <span class="min-w-0 flex-1">{linea.nombre}</span>
          <span class="font-medium tabular-nums">{formatMoney(linea.totalCents)}</span>
        </li>
      {/each}
      {#if pedido.tarifaEntregaCents !== undefined}
        <li class="flex items-baseline justify-between gap-2 text-sm text-piedra">
          <span>Tarifa de entrega</span>
          <span class="tabular-nums">{formatMoney(pedido.tarifaEntregaCents)}</span>
        </li>
      {/if}
    </ul>
  {/if}

  {#if pedido.nota}
    <p class="flex items-start gap-2.5 rounded-lg bg-tinta/5 px-3 py-2.5 text-sm">
      <StickyNote class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span><strong class="font-semibold">Nota:</strong> "{pedido.nota}"</span>
    </p>
  {/if}

  <div class="mt-auto grid gap-3">
    <p class="flex items-baseline justify-between gap-3 border-t border-linea pt-4">
      <span class="text-sm text-piedra">{totalEtiqueta}</span>
      <span class="text-xl font-semibold tabular-nums"
        >{formatMoney(pedido.totalCents)}
        <span class="text-base">MXN</span></span
      >
    </p>

    {#if resultado && !resultado.ok && resultado.error}
      <p class="text-sm text-error" role="alert">{resultado.error}</p>
    {/if}

    <form
      method="POST"
      action="/app?/avanzar"
      use:enhance={() => {
        enviando = "avanzar";
        return async ({ update }) => {
          await update();
          enviando = null;
        };
      }}
    >
      <input type="hidden" name="id" value={pedido.id} />
      <Button type="submit" class="w-full" disabled={enviando !== null}>
        {#if enviando === "avanzar"}
          {principal.enviando}
        {:else}
          {#if pendiente}
            <CircleCheck aria-hidden="true" />
          {:else if pedido.estado === "preparing"}
            <CheckCheck aria-hidden="true" />
          {:else if pedido.estado === "ready" && pedido.modalidad === "domicilio"}
            <Bike aria-hidden="true" />
          {/if}
          {principal.label}
        {/if}
      </Button>
    </form>

    {#if pendiente}
      <details class="group rounded-lg border border-linea" open={Boolean(errorMotivo)}>
        <summary
          class="flex min-h-11 cursor-pointer list-none items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors hover:bg-cal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal"
        >
          <ChevronDown
            class="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
          Rechazar pedido
        </summary>
        <form
          method="POST"
          action="/app?/rechazar"
          class="grid gap-3 border-t border-linea p-4"
          use:enhance={() => {
            enviando = "rechazar";
            return async ({ update }) => {
              await update({ reset: false });
              enviando = null;
            };
          }}
        >
          <input type="hidden" name="id" value={pedido.id} />
          <div>
            <label for={idMotivo} class="text-sm font-medium">Motivo del rechazo</label>
            <textarea
              id={idMotivo}
              name="motivo"
              rows="2"
              maxlength="200"
              aria-required="true"
              aria-invalid={errorMotivo ? "true" : undefined}
              aria-describedby={errorMotivo ? idErrorMotivo : undefined}
              placeholder="Ej.: Nos quedamos sin pastor por hoy."
              class="mt-1.5 w-full rounded-lg border border-linea bg-white px-4 py-3 text-tinta outline-none placeholder:text-piedra focus:border-nopal focus:ring-2 focus:ring-nopal/20 aria-[invalid=true]:border-error"
              >{resultado?.values?.motivo ?? ""}</textarea
            >
            {#if errorMotivo}
              <p id={idErrorMotivo} class="mt-1.5 text-sm text-error">{errorMotivo}</p>
            {/if}
          </div>
          <Button type="submit" variant="destructive" disabled={enviando !== null}>
            {enviando === "rechazar" ? "Rechazando…" : "Confirmar rechazo"}
          </Button>
        </form>
      </details>
    {/if}
  </div>
</article>
