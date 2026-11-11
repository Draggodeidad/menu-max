<script lang="ts">
  import { invalidate } from "$app/navigation";
  import { MediaQuery } from "svelte/reactivity";
  import { fade } from "svelte/transition";
  import Check from "@lucide/svelte/icons/check";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import Phone from "@lucide/svelte/icons/phone";
  import type { PageProps } from "./$types";
  import { Button } from "#lib/components/ui/button/index.js";
  import { formatMoney } from "#lib/money.js";

  let { data }: PageProps = $props();
  const pedido = $derived(data.pedido);
  const reducedMotion = new MediaQuery("(prefers-reduced-motion: reduce)");
  const duration = $derived(reducedMotion.current ? 0 : 200);

  // Mismos derivados del tema que `m/[slug]/+layout.svelte` (DESIGN.md §3.6).
  const vars = $derived(
    `--brand:${data.tema.brand};--brand-bg:${data.tema.bg};--brand-text:${data.tema.text};` +
      `--brand-muted:color-mix(in srgb,${data.tema.text} 70%,${data.tema.bg});` +
      `--brand-line:color-mix(in srgb,${data.tema.text} 12%,${data.tema.bg});` +
      `--brand-tint:color-mix(in srgb,${data.tema.text} 8%,${data.tema.bg})`,
  );

  const pasos = $derived.by(() => {
    const listo =
      pedido.modalidad === "mesa"
        ? "Listo para tu mesa"
        : pedido.modalidad === "domicilio"
          ? "Listo para salir"
          : "Listo para recoger";
    return [
      { estado: "pending", label: "Pedido enviado" },
      { estado: "accepted", label: "Pedido aceptado" },
      { estado: "preparing", label: "En preparación" },
      { estado: "ready", label: listo },
      ...(pedido.modalidad === "domicilio"
        ? [{ estado: "out_for_delivery", label: "En camino" }]
        : []),
      { estado: "delivered", label: "Entregado" },
    ];
  });

  const actual = $derived(
    Math.max(
      0,
      pasos.findIndex((p) => p.estado === pedido.estado),
    ),
  );
  const rechazado = $derived(pedido.estado === "rejected");
  const final = $derived(rechazado || pedido.estado === "delivered");
  // "Llamar al negocio" solo si hay un problema (DESIGN.md §7.2-J).
  const hayProblema = $derived(rechazado || pedido.retraso);

  const titulo = $derived(
    rechazado
      ? "El negocio no pudo aceptar tu pedido"
      : pedido.estado === "delivered"
        ? "Tu pedido fue entregado"
        : `${pasos[actual].label}`,
  );

  // Polling cada 10 s que se detiene en estados finales (sincroniza con un intervalo externo).
  $effect(() => {
    if (final) return;
    const id = setInterval(() => invalidate("app:pedido"), 10_000);
    return () => clearInterval(id);
  });
</script>

<svelte:head>
  <title>Pedido {pedido.codigo} · {pedido.negocio.nombre}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div style={vars} class="min-h-dvh bg-(color:--brand-bg) text-(color:--brand-text)">
  <main
    class="mx-auto min-h-dvh max-w-md bg-(color:--brand-bg) md:border-x md:border-(color:--brand-line)"
  >
    <header class="px-5 pt-8 pb-6">
      <p class="text-base text-(color:--brand-muted)">
        {pedido.negocio.nombre} · Pedido {pedido.codigo}{pedido.modalidad === "mesa"
          ? ` · Mesa ${pedido.mesa}`
          : ""}
      </p>
      <div aria-live="polite">
        {#key titulo}
          <h1 in:fade={{ duration }} class="mt-2 text-3xl font-bold tracking-[-0.03em]">
            {titulo}
          </h1>
        {/key}
      </div>
      {#if rechazado}
        <p class="mt-2 max-w-[60ch] text-base leading-relaxed text-(color:--brand-muted)">
          {pedido.motivoRechazo} No se te cobrará nada.
        </p>
      {:else if !final}
        <p class="mt-2 text-base text-(color:--brand-muted)">
          Esta página se actualiza sola. No necesitas recargarla.
        </p>
      {/if}
    </header>

    {#if hayProblema}
      <section class="border-t border-(color:--brand-line) px-5 py-6" aria-labelledby="problema">
        <div class="flex items-start gap-3 rounded-xl border border-(color:--brand-text) p-4">
          <CircleAlert aria-hidden="true" class="mt-0.5 size-5 shrink-0" />
          <div class="min-w-0">
            <h2 id="problema" class="text-lg font-semibold tracking-[-0.02em]">
              {rechazado ? "Puedes hacer otro pedido" : "Tu pedido tarda más de lo normal"}
            </h2>
            <p class="mt-1 text-sm text-(color:--brand-muted)">
              {rechazado
                ? "Llama al negocio si tienes dudas."
                : "Si necesitas saber qué pasa, llama al negocio."}
            </p>
          </div>
        </div>
        <Button
          href="tel:{pedido.negocio.telefono}"
          size="lg"
          class="mt-4 w-full rounded-lg bg-(color:--brand) text-(color:--brand-bg) hover:bg-(color:--brand)/90 focus-visible:ring-(color:--brand)/30"
        >
          <Phone aria-hidden="true" />
          Llamar al negocio
        </Button>
      </section>
    {/if}

    {#if !rechazado}
      <section class="border-t border-(color:--brand-line) px-5 py-6" aria-labelledby="estado">
        <h2 id="estado" class="text-xl font-semibold tracking-[-0.02em]">Estado del pedido</h2>
        <ol class="mt-5">
          {#each pasos as paso, i (paso.estado)}
            {@const hecho = i < actual || pedido.estado === "delivered"}
            {@const ahora = i === actual && pedido.estado !== "delivered"}
            <li
              class="relative flex gap-4 pb-6 last:pb-0"
              aria-current={ahora ? "step" : undefined}
            >
              {#if i < pasos.length - 1}
                <span
                  aria-hidden="true"
                  class="absolute top-8 bottom-0 left-4 w-px -translate-x-1/2 {hecho
                    ? 'bg-(color:--brand)'
                    : 'bg-(color:--brand-line)'}"
                ></span>
              {/if}
              <span
                aria-hidden="true"
                class="relative z-10 grid size-8 shrink-0 place-items-center rounded-full border {hecho
                  ? 'border-(color:--brand) bg-(color:--brand) text-(color:--brand-bg)'
                  : ahora
                    ? 'border-(color:--brand) bg-(color:--brand-bg)'
                    : 'border-(color:--brand-line) bg-(color:--brand-bg)'}"
              >
                {#if hecho}
                  <Check class="size-4" />
                {:else if ahora}
                  <span class="size-3 rounded-full bg-(color:--brand)"></span>
                {/if}
              </span>
              <div class="min-h-8 pt-1">
                <p
                  class="text-base {ahora
                    ? 'font-semibold'
                    : hecho
                      ? 'font-medium'
                      : 'text-(color:--brand-muted)'}"
                >
                  {paso.label}
                </p>
                {#if ahora}
                  <p in:fade={{ duration }} class="text-sm text-(color:--brand-muted)">
                    <span class="sr-only">Paso actual. </span>Ahora
                  </p>
                {/if}
              </div>
            </li>
          {/each}
        </ol>
      </section>
    {/if}

    <section class="border-t border-(color:--brand-line) px-5 py-6" aria-labelledby="resumen">
      <h2 id="resumen" class="text-xl font-semibold tracking-[-0.02em]">Tu pedido</h2>
      <ul class="mt-4 divide-y divide-(color:--brand-line)">
        {#each pedido.lineas as l (l.id)}
          <li class="flex items-baseline justify-between gap-4 py-3">
            <span class="text-base">
              <span class="tabular-nums">{l.cantidad}</span> × {l.nombre}
            </span>
            <span class="font-medium tabular-nums">{formatMoney(l.totalCents)}</span>
          </li>
        {/each}
      </ul>
      <p
        class="flex items-baseline justify-between border-t border-(color:--brand-line) pt-4 text-lg font-semibold"
      >
        <span>Total</span>
        <span class="tabular-nums">{formatMoney(pedido.totalCents)}</span>
      </p>
      <p class="mt-2 text-sm text-(color:--brand-muted)">Pagas en efectivo al recibir.</p>
    </section>
  </main>
</div>
