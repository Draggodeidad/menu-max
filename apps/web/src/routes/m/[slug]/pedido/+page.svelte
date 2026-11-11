<script lang="ts">
  import { enhance } from "$app/forms";
  import { fly } from "svelte/transition";
  import Minus from "@lucide/svelte/icons/minus";
  import Plus from "@lucide/svelte/icons/plus";
  import type { PageProps } from "./$types";
  import { getCart } from "#lib/cart.svelte.js";
  import StorefrontSkeleton from "#lib/components/StorefrontSkeleton.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { formatMoney } from "#lib/money.js";

  let { data, form }: PageProps = $props();
  const cart = getCart();

  let enviando = $state(false);

  const query = $derived(data.mesa ? `?mesa=${encodeURIComponent(data.mesa)}` : "");
  const menuHref = $derived(`/m/${data.negocio.slug}${query}`);
  const puedeEnviar = $derived(data.negocio.abierto && cart.count > 0 && !enviando);

  const brandBtn =
    "rounded-lg bg-(color:--brand) text-(color:--brand-bg) hover:bg-(color:--brand)/90";
  const outlineBtn =
    "border-(color:--brand-line) bg-transparent text-(color:--brand-text) hover:bg-(color:--brand-tint)";
</script>

<svelte:head>
  <title>Tu pedido · {data.negocio.nombre}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#if !cart.ready && !form?.enviado}
  <!-- Mientras se lee el carrito guardado en el navegador. Sin JavaScript se oculta. -->
  <StorefrontSkeleton variant="pedido" />
  <noscript>
    <div class="mx-auto max-w-md px-5 py-16">
      <h1 class="text-3xl font-bold tracking-[-0.03em]">Tu pedido</h1>
      <p class="mt-2 text-base text-(color:--brand-muted)">
        Para armar y enviar tu pedido activa JavaScript.
      </p>
      <Button href={menuHref} class="mt-6 {brandBtn}">Ver menú</Button>
    </div>
  </noscript>
{:else}
  <div
    class="mx-auto min-h-dvh max-w-md bg-(color:--brand-bg) md:border-x md:border-(color:--brand-line)"
  >
    <header class="px-5 pt-6 pb-5">
      <a
        href={menuHref}
        class="inline-flex min-h-11 items-center rounded-lg text-sm font-medium text-(color:--brand-muted) underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-(color:--brand)/30"
      >
        Volver al menú
      </a>
      <h1 class="mt-1 text-3xl font-bold tracking-[-0.03em]">Tu pedido</h1>
      <p class="mt-1.5 text-base text-(color:--brand-muted)">
        {data.negocio.nombre}{data.mesa ? ` · Mesa ${data.mesa}` : ""}
      </p>
    </header>

    {#if form?.enviado}
      <section class="px-5 py-10" aria-live="polite">
        <h2 class="text-xl font-semibold tracking-[-0.02em]">Pedido enviado</h2>
        <p class="mt-2 max-w-[60ch] text-base leading-relaxed text-(color:--brand-muted)">
          {data.negocio.nombre} ya lo recibió. Pagas en efectivo al recibir.
        </p>
        <Button href={menuHref} variant="outline" class="mt-6 {outlineBtn}">Volver al menú</Button>
      </section>
    {:else if cart.count === 0}
      <section class="px-5 py-10">
        <h2 class="text-xl font-semibold tracking-[-0.02em]">Tu pedido está vacío</h2>
        <p class="mt-2 max-w-[60ch] text-base leading-relaxed text-(color:--brand-muted)">
          Agrega productos desde el menú y aquí verás el resumen.
        </p>
        <Button href={menuHref} class="mt-6 {brandBtn}">Ver menú</Button>
      </section>
    {:else}
      <form
        method="POST"
        action="{query}{query ? '&' : '?'}/enviar"
        use:enhance={() => {
          enviando = true;
          return async ({ result, update }) => {
            await update({ reset: false });
            if (result.type === "success") cart.clear();
            enviando = false;
          };
        }}
      >
        <input type="hidden" name="idempotencyKey" value={data.idempotencyKey} />

        <ul class="border-t border-(color:--brand-line) px-5">
          {#each cart.lines as l (l.key)}
            <li
              in:fly={{ y: -8, duration: 200 }}
              class="flex items-center gap-4 border-b border-(color:--brand-line) py-4"
            >
              <input type="hidden" name="id" value={l.productId} />
              <input type="hidden" name="opcion" value={l.opcion ?? ""} />
              <input type="hidden" name="cantidad" value={l.cantidad} />
              <div class="min-w-0 flex-1">
                <p class="text-base font-semibold">{l.nombre}</p>
                {#if l.opcion}
                  <p class="text-sm text-(color:--brand-muted)">{l.opcion}</p>
                {/if}
                <p class="mt-1 text-sm font-medium tabular-nums">
                  {formatMoney(l.precioCents * l.cantidad)}
                </p>
              </div>
              <div class="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Quitar uno de {l.nombre}"
                  onclick={() => cart.setQty(l.key, l.cantidad - 1)}
                  class={outlineBtn}
                >
                  <Minus aria-hidden="true" />
                </Button>
                <span class="w-8 text-center font-semibold tabular-nums" aria-live="polite">
                  {l.cantidad}
                </span>
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Agregar uno de {l.nombre}"
                  disabled={l.cantidad >= 99}
                  onclick={() => cart.setQty(l.key, l.cantidad + 1)}
                  class={outlineBtn}
                >
                  <Plus aria-hidden="true" />
                </Button>
              </div>
            </li>
          {/each}
        </ul>

        <div class="px-5 pt-5 pb-40">
          <p class="flex items-baseline justify-between text-lg font-semibold">
            <span>Total</span>
            <span class="tabular-nums" aria-live="polite">{formatMoney(cart.totalCents)}</span>
          </p>
          <p class="mt-1 text-sm text-(color:--brand-muted)">
            Pagas en efectivo al recibir. El negocio confirma el total final.
          </p>
          {#if form?.error}
            <p class="mt-4 text-base font-medium" role="alert">{form.error}</p>
          {/if}
        </div>

        <div
          class="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md bg-(color:--brand-bg) px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          {#if !data.negocio.abierto}
            <p class="mb-2 px-2 text-sm text-(color:--brand-muted)">
              Cerrado · abre a las {data.negocio.abre}. Podrás enviar tu pedido cuando abra.
            </p>
          {/if}
          <Button type="submit" size="lg" disabled={!puedeEnviar} class="w-full {brandBtn}">
            {enviando ? "Enviando…" : `Enviar pedido · ${formatMoney(cart.totalCents)}`}
          </Button>
        </div>
      </form>
    {/if}
  </div>
{/if}
