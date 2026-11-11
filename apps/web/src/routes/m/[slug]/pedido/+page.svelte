<script lang="ts">
  import { enhance, type SubmitFunction } from "$app/forms";
  import { tick, untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { fly, slide } from "svelte/transition";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import Banknote from "@lucide/svelte/icons/banknote";
  import Bike from "@lucide/svelte/icons/bike";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import Minus from "@lucide/svelte/icons/minus";
  import Plus from "@lucide/svelte/icons/plus";
  import Store from "@lucide/svelte/icons/store";
  import type { PageProps } from "./$types";
  import { getCart } from "#lib/cart.svelte.js";
  import StorefrontSkeleton from "#lib/components/StorefrontSkeleton.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import { formatMoney } from "#lib/money.js";

  type Campo = "nombre" | "telefono" | "direccion" | "notas";
  type Modalidad = "recoger" | "domicilio";

  let { data, form }: PageProps = $props();
  const cart = getCart();
  const reducedMotion = new MediaQuery("(prefers-reduced-motion: reduce)");
  const duration = $derived(reducedMotion.current ? 0 : 200);

  let enviando = $state(false);
  let formEl = $state<HTMLFormElement>();

  // Sin JavaScript el formulario vuelve con `form.values`; con JavaScript los campos no se reinician.
  // svelte-ignore state_referenced_locally -- solo valores iniciales
  const previos = form?.values;
  let modalidad = $state<Modalidad>(previos?.modalidad === "domicilio" ? "domicilio" : "recoger");
  let nombre = $state(previos?.nombre ?? "");
  let telefono = $state(previos?.telefono ?? "");
  let direccion = $state(previos?.direccion ?? "");
  let notas = $state(previos?.notas ?? "");
  let recordar = $state(true);

  const query = $derived(data.mesa ? `?mesa=${encodeURIComponent(data.mesa)}` : "");
  const menuHref = $derived(`/m/${data.negocio.slug}${query}`);
  const puedeEnviar = $derived(data.negocio.abierto && cart.count > 0 && !enviando);
  const errores = $derived(form?.fieldErrors ?? {});

  const modalidades = [
    { valor: "recoger", label: "Para recoger", icono: Store },
    { valor: "domicilio", label: "A domicilio", icono: Bike },
  ] as const;

  const nota = $derived(
    modalidad === "domicilio"
      ? `Entrega en aprox. ${data.entrega.domicilio.tiempo}.`
      : `Listo en mostrador en aprox. ${data.entrega.recoger.tiempo}. ${data.entrega.recoger.direccion}.`,
  );

  const DATOS_KEY = "menusmax:datos";

  // Lee los datos recordados del navegador (sistema externo).
  $effect(() => {
    try {
      const guardado: unknown = JSON.parse(localStorage.getItem(DATOS_KEY) ?? "null");
      if (!guardado || typeof guardado !== "object") return;
      const d = guardado as Record<string, unknown>;
      untrack(() => {
        if (!nombre && typeof d.nombre === "string") nombre = d.nombre;
        if (!telefono && typeof d.telefono === "string") telefono = d.telefono;
        if (!direccion && typeof d.direccion === "string") direccion = d.direccion;
      });
    } catch {
      // almacenamiento bloqueado o dato corrupto: se empieza vacío
    }
  });

  function guardarDatos() {
    try {
      if (recordar)
        localStorage.setItem(DATOS_KEY, JSON.stringify({ nombre, telefono, direccion }));
      else localStorage.removeItem(DATOS_KEY);
    } catch {
      // sin almacenamiento: no se recuerdan los datos
    }
  }

  const enviar: SubmitFunction = () => {
    enviando = true;
    return async ({ result, update }) => {
      if (result.type === "redirect") {
        guardarDatos();
        // El seguimiento vive fuera de este layout: se vacía y guarda antes de navegar.
        cart.clear();
        cart.persist();
      }
      await update({ reset: false });
      enviando = false;
      if (result.type === "failure") {
        await tick();
        formEl?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus();
      }
    };
  };

  const brandBtn =
    "rounded-lg bg-(color:--brand) text-(color:--brand-bg) hover:bg-(color:--brand)/90 focus-visible:ring-(color:--brand)/30";
  const outlineBtn =
    "border-(color:--brand-line) bg-transparent text-(color:--brand-text) hover:bg-(color:--brand-tint)";
  const campo =
    "border-(color:--brand-line) bg-(color:--brand-bg) text-(color:--brand-text) placeholder:text-(color:--brand-muted) focus-visible:border-(color:--brand) focus-visible:ring-(color:--brand)/30 aria-invalid:border-(color:--brand-text) aria-invalid:ring-(color:--brand-text)/20";
  const seccion = "border-t border-(color:--brand-line) px-5 py-6";
  const h2 = "text-xl font-semibold tracking-[-0.02em]";
</script>

<svelte:head>
  <title>Tu pedido · {data.negocio.nombre}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#snippet error(id: string, mensaje?: string)}
  {#if mensaje}
    <p {id} class="mt-1.5 flex items-start gap-1.5 text-sm font-medium">
      <CircleAlert aria-hidden="true" class="mt-0.5 size-4 shrink-0" />
      {mensaje}
    </p>
  {/if}
{/snippet}

{#snippet etiqueta(para: string, texto: string, ayuda: string)}
  <div class="mb-1.5 flex items-baseline justify-between gap-3">
    <Label for={para} class="shrink-0 text-base font-medium whitespace-nowrap">{texto}</Label>
    <span class="text-right text-sm text-(color:--brand-muted)">{ayuda}</span>
  </div>
{/snippet}

{#if !cart.ready}
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
    <header class="px-5 pt-4 pb-6">
      <a
        href={menuHref}
        class="-ml-2 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-(color:--brand-muted) outline-none hover:text-(color:--brand-text) focus-visible:ring-2 focus-visible:ring-(color:--brand)/30"
      >
        <ArrowLeft aria-hidden="true" class="size-4" />
        Volver al menú
      </a>
      <div class="mt-2 flex items-start justify-between gap-3">
        <h1 class="text-3xl font-bold tracking-[-0.03em]">Tu pedido</h1>
        {#if cart.count > 0}
          <p
            class="mt-1.5 rounded-full bg-(color:--brand-tint) px-3 py-1 text-sm font-medium tabular-nums"
            aria-live="polite"
          >
            {cart.count}
            {cart.count === 1 ? "producto" : "productos"}
          </p>
        {/if}
      </div>
      <p class="mt-1.5 text-base text-(color:--brand-muted)">
        {data.negocio.nombre} · {data.entrega.sucursal}{data.mesa ? ` · Mesa ${data.mesa}` : ""}
      </p>
    </header>

    {#if cart.count === 0}
      <section class="border-t border-(color:--brand-line) px-5 py-10">
        <h2 class={h2}>Tu pedido está vacío</h2>
        <p class="mt-2 max-w-[60ch] text-base leading-relaxed text-(color:--brand-muted)">
          Agrega productos desde el menú y aquí verás el resumen.
        </p>
        <Button href={menuHref} class="mt-6 {brandBtn}">Ver menú</Button>
      </section>
    {:else}
      <form
        bind:this={formEl}
        method="POST"
        action="{query}{query ? '&' : '?'}/enviar"
        novalidate
        use:enhance={enviar}
      >
        <input type="hidden" name="idempotencyKey" value={data.idempotencyKey} />
        {#if data.mesa}
          <input type="hidden" name="modalidad" value="mesa" />
        {/if}

        <section class={seccion} aria-labelledby="detalle">
          <div class="flex items-baseline justify-between gap-3">
            <h2 id="detalle" class={h2}>Detalle de consumo</h2>
            <span class="text-sm text-(color:--brand-muted)">Comanda directa</span>
          </div>

          <div class="mt-4 overflow-hidden rounded-xl border border-(color:--brand-line)">
            <ul class="divide-y divide-(color:--brand-line)">
              {#each cart.lines as l (l.key)}
                <li in:fly={{ y: -8, duration }} class="px-4 py-4">
                  <input type="hidden" name="id" value={l.productId} />
                  <input type="hidden" name="opcion" value={l.opcion ?? ""} />
                  <input type="hidden" name="cantidad" value={l.cantidad} />
                  <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0">
                      <p class="text-base font-semibold">{l.nombre}</p>
                      {#if l.opcion}
                        <p class="text-sm text-(color:--brand-muted)">{l.opcion}</p>
                      {/if}
                    </div>
                    <p class="font-semibold tabular-nums">
                      {formatMoney(l.precioCents * l.cantidad)}
                    </p>
                  </div>
                  <div class="mt-2 flex items-center justify-between gap-4">
                    <p class="text-sm text-(color:--brand-muted) tabular-nums">
                      {formatMoney(l.precioCents)} c/u
                    </p>
                    <div class="flex items-center rounded-lg bg-(color:--brand-tint)">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={l.cantidad === 1
                          ? `Quitar ${l.nombre}`
                          : `Quitar uno de ${l.nombre}`}
                        onclick={() => cart.setQty(l.key, l.cantidad - 1)}
                        class="text-(color:--brand-text) hover:bg-(color:--brand-line) focus-visible:ring-(color:--brand)/30"
                      >
                        <Minus aria-hidden="true" />
                      </Button>
                      <span class="w-8 text-center font-semibold tabular-nums" aria-live="polite">
                        {l.cantidad}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Agregar uno de {l.nombre}"
                        disabled={l.cantidad >= 99}
                        onclick={() => cart.setQty(l.key, l.cantidad + 1)}
                        class="text-(color:--brand-text) hover:bg-(color:--brand-line) focus-visible:ring-(color:--brand)/30"
                      >
                        <Plus aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </li>
              {/each}
            </ul>
            <p
              class="flex items-baseline justify-between gap-3 border-t border-(color:--brand-line) bg-(color:--brand-tint) px-4 py-4"
            >
              <span class="text-base">Subtotal de consumo</span>
              <span class="text-lg font-semibold tabular-nums" aria-live="polite">
                {formatMoney(cart.totalCents)}
              </span>
            </p>
          </div>
        </section>

        {#if !data.mesa}
          <fieldset class="{seccion} min-w-0">
            <legend class="float-left w-full {h2}">Modalidad de entrega</legend>
            <div
              class="mt-4 grid clear-both grid-cols-2 rounded-lg border border-(color:--brand-line) p-1"
            >
              {#each modalidades as m (m.valor)}
                <label
                  class="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors has-checked:bg-(color:--brand) has-checked:text-(color:--brand-bg) has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-(color:--brand)"
                >
                  <input
                    type="radio"
                    name="modalidad"
                    value={m.valor}
                    bind:group={modalidad}
                    class="sr-only"
                  />
                  <m.icono aria-hidden="true" class="size-4" />
                  {m.label}
                </label>
              {/each}
            </div>
            <p
              class="mt-3 flex items-start gap-2 text-sm text-(color:--brand-muted)"
              aria-live="polite"
            >
              <CircleCheck aria-hidden="true" class="mt-0.5 size-4 shrink-0" />
              {nota}
            </p>

            {#if modalidad === "domicilio"}
              <div class="mt-5" transition:slide={{ duration }}>
                {@render etiqueta("direccion", "Dirección de entrega", "Requerido")}
                <Input
                  id="direccion"
                  name="direccion"
                  bind:value={direccion}
                  autocomplete="street-address"
                  placeholder="Calle, número y colonia"
                  required
                  aria-invalid={errores.direccion ? "true" : undefined}
                  aria-describedby={errores.direccion ? "direccion-error" : undefined}
                  class={campo}
                />
                {@render error("direccion-error", errores.direccion)}
              </div>
            {/if}
          </fieldset>
        {/if}

        <section class={seccion} aria-labelledby="datos">
          <h2 id="datos" class={h2}>Datos del cliente</h2>

          <div class="mt-4">
            {@render etiqueta("nombre", "Nombre completo", "Requerido")}
            <Input
              id="nombre"
              name="nombre"
              bind:value={nombre}
              autocomplete="name"
              placeholder="Tu nombre"
              required
              aria-invalid={errores.nombre ? "true" : undefined}
              aria-describedby={errores.nombre ? "nombre-error" : undefined}
              class={campo}
            />
            {@render error("nombre-error", errores.nombre)}
          </div>

          <div class="mt-5">
            {@render etiqueta("telefono", "Teléfono (WhatsApp)", "Para confirmar comanda")}
            <div
              class="flex h-12 items-center rounded-lg border border-(color:--brand-line) bg-(color:--brand-bg) focus-within:border-(color:--brand) focus-within:ring-2 focus-within:ring-(color:--brand)/30 has-aria-invalid:border-(color:--brand-text) has-aria-invalid:ring-2 has-aria-invalid:ring-(color:--brand-text)/20"
            >
              <span class="pl-4 text-sm text-(color:--brand-muted)" aria-hidden="true">+52</span>
              <Input
                id="telefono"
                name="telefono"
                type="tel"
                bind:value={telefono}
                inputmode="tel"
                autocomplete="tel-national"
                maxlength={14}
                placeholder="55 1234 5678"
                required
                aria-invalid={errores.telefono ? "true" : undefined}
                aria-describedby={errores.telefono ? "telefono-error" : undefined}
                class="h-full flex-1 border-0 bg-transparent pl-2 text-(color:--brand-text) placeholder:text-(color:--brand-muted) focus-visible:ring-0 aria-invalid:ring-0"
              />
            </div>
            {@render error("telefono-error", errores.telefono)}
          </div>

          <div class="mt-5">
            {@render etiqueta("notas", "Notas para la cocina", "Opcional")}
            <textarea
              id="notas"
              name="notas"
              bind:value={notas}
              rows={3}
              maxlength={200}
              placeholder="Ej. Salsa roja aparte, sin cebolla, limón extra…"
              aria-invalid={errores.notas ? "true" : undefined}
              aria-describedby={errores.notas ? "notas-error" : undefined}
              class="min-h-24 w-full resize-y rounded-lg border bg-transparent px-4 py-3 text-base outline-none focus-visible:ring-2 aria-invalid:ring-2 {campo}"
            ></textarea>
            {@render error("notas-error", errores.notas)}
          </div>
        </section>

        <section class={seccion} aria-labelledby="pago">
          <div class="flex items-start gap-3 rounded-xl bg-(color:--brand-tint) p-4">
            <Banknote aria-hidden="true" class="mt-0.5 size-5 shrink-0" />
            <div>
              <h2 id="pago" class="text-lg font-semibold tracking-[-0.02em]">
                Pagas en efectivo al recibir
              </h2>
              <p class="mt-1 text-sm text-(color:--brand-muted)">
                Liquidación directa en barra o con el repartidor. No requerimos pagos por
                adelantado.
              </p>
            </div>
          </div>

          <label class="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="recordar"
              bind:checked={recordar}
              class="size-5 shrink-0 cursor-pointer accent-(color:--brand) outline-none focus-visible:ring-2 focus-visible:ring-(color:--brand)/30 focus-visible:ring-offset-2"
            />
            Recordar mis datos en este teléfono para la próxima vez
          </label>
        </section>

        {#if form?.error}
          <p
            class="mx-5 mb-6 flex items-start gap-2 rounded-xl border border-(color:--brand-text) p-4 text-base font-medium outline-none"
            role="alert"
            tabindex="-1"
          >
            <CircleAlert aria-hidden="true" class="mt-0.5 size-5 shrink-0" />
            {form.error}
          </p>
        {/if}

        <div class="pb-40"></div>

        <div
          class="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md border-t border-(color:--brand-line) bg-(color:--brand-bg) px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
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
