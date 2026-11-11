<script lang="ts">
  import { enhance, type SubmitFunction } from "$app/forms";
  import Camera from "@lucide/svelte/icons/camera";
  import Check from "@lucide/svelte/icons/check";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Plus from "@lucide/svelte/icons/plus";
  import ProductImage from "#lib/components/ProductImage.svelte";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import { formatMoney, formatMoneyInput, parseMoneyToCents } from "#lib/money.js";
  import type { ProductoCatalogo, ResultadoCatalogo } from "#lib/server/demo.js";
  import ConfirmarEliminar from "./ConfirmarEliminar.svelte";

  type Props = { producto: ProductoCatalogo; resultado?: ResultadoCatalogo | null };

  let { producto, resultado }: Props = $props();

  const propio = $derived(resultado?.id === producto.id ? resultado : undefined);
  const errorPrecio = $derived(
    propio?.accion === "guardar" ? propio.fieldErrors?.precio : undefined,
  );
  const errorVariante = $derived(
    propio?.accion === "agregar-variante" ? propio.fieldErrors : undefined,
  );

  // Se reinicia cuando cambia el precio guardado o el servidor devuelve el valor rechazado.
  let precioTexto = $derived(
    (propio?.accion === "guardar" ? propio.values?.precio : undefined) ??
      formatMoneyInput(producto.precioCents),
  );
  let guardando = $state(false);
  const guardado = $derived(propio?.ok === true && propio.accion === "guardar" && !guardando);

  const activas = $derived(producto.variantes.filter((v) => v.activa).length);

  let detallesVariante: HTMLDetailsElement | undefined = $state();

  const guardarProducto: SubmitFunction = () => {
    guardando = true;
    return async ({ result, update }) => {
      await update({ reset: false });
      guardando = false;
      const cents = parseMoneyToCents(precioTexto);
      if (result.type === "success" && cents !== null) precioTexto = formatMoneyInput(cents);
    };
  };

  const agregarVariante: SubmitFunction = () => {
    return async ({ result, update }) => {
      await update();
      if (result.type === "success" && detallesVariante) detallesVariante.open = false;
    };
  };

  const autoenviar = (e: Event & { currentTarget: HTMLInputElement }) =>
    e.currentTarget.form?.requestSubmit();

  const focoRing =
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal";
</script>

<li id="producto-{producto.id}" class="px-4 py-4 sm:px-5">
  <div class="grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-3 lg:grid-cols-[auto_1fr_auto]">
    {#if producto.imagen}
      <ProductImage src={producto.imagen} alt={producto.nombre} class="bg-cal" />
    {:else}
      <form
        method="POST"
        action="?/subirFoto"
        enctype="multipart/form-data"
        use:enhance
        class="size-16"
      >
        <input type="hidden" name="id" value={producto.id} />
        <label
          class="grid size-16 cursor-pointer place-items-center rounded-xl border border-dashed border-piedra text-piedra transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-nopal hover:bg-cal"
        >
          <input
            type="file"
            name="foto"
            accept="image/*"
            class="sr-only"
            aria-label="Subir foto de {producto.nombre}"
            onchange={autoenviar}
          />
          <span class="grid justify-items-center gap-0.5 text-sm leading-none">
            <Camera class="size-5" aria-hidden="true" />
            Subir
          </span>
        </label>
        <noscript
          ><button type="submit" class="text-sm text-nopal underline">Guardar</button></noscript
        >
      </form>
    {/if}

    <div class="min-w-0">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 class="text-lg font-semibold tracking-[-0.02em]">{producto.nombre}</h3>
        {#if !producto.disponible}
          <span
            class="rounded-full border border-linea bg-cal px-2.5 py-0.5 text-sm font-medium text-piedra"
          >
            Agotado
          </span>
        {/if}
        {#if guardado}
          <span
            class="inline-flex items-center gap-1 rounded-full bg-cal px-2.5 py-0.5 text-sm font-medium text-nopal"
          >
            <Check class="size-3.5" aria-hidden="true" />
            Guardado
          </span>
        {/if}
      </div>
      {#if producto.descripcion}
        <p class="mt-0.5 max-w-prose text-sm text-piedra">{producto.descripcion}</p>
      {/if}
    </div>

    <div class="col-span-2 flex items-center justify-between gap-2 lg:col-span-1 lg:justify-end">
      <form
        method="POST"
        action="?/guardar"
        class="flex items-center gap-3"
        aria-busy={guardando}
        use:enhance={guardarProducto}
      >
        <input type="hidden" name="id" value={producto.id} />
        <div class="relative">
          <Label for="precio-{producto.id}" class="sr-only"
            >Precio de {producto.nombre} en pesos</Label
          >
          <span
            class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-piedra"
            aria-hidden="true">$</span
          >
          <Input
            id="precio-{producto.id}"
            name="precio"
            inputmode="decimal"
            autocomplete="off"
            bind:value={precioTexto}
            aria-invalid={errorPrecio ? "true" : undefined}
            aria-describedby={errorPrecio ? "precio-error-{producto.id}" : undefined}
            onchange={autoenviar}
            class="w-32 pl-7 text-right font-semibold tabular-nums"
          />
        </div>
        <label class="relative inline-flex min-h-11 min-w-11 cursor-pointer items-center">
          <input
            type="checkbox"
            role="switch"
            name="disponible"
            checked={producto.disponible}
            onchange={autoenviar}
            class="peer sr-only"
          />
          <span
            class="relative h-6 w-11 rounded-full border border-piedra bg-cal transition-colors peer-checked:border-nopal peer-checked:bg-nopal peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-nopal after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-piedra after:transition-transform peer-checked:after:translate-x-5 peer-checked:after:bg-white motion-reduce:transition-none motion-reduce:after:transition-none"
            aria-hidden="true"
          ></span>
          <span class="sr-only">Disponible</span>
        </label>
        <noscript
          ><button type="submit" class="text-sm text-nopal underline">Guardar</button></noscript
        >
      </form>

      <ConfirmarEliminar
        accion="?/eliminar"
        campos={{ id: producto.id }}
        etiqueta="Eliminar {producto.nombre}"
        titulo="¿Eliminar este producto?"
        detalle="«{producto.nombre}» saldrá de tu menú y de tu menú público."
      />
    </div>
  </div>

  {#if errorPrecio}
    <p id="precio-error-{producto.id}" class="mt-1.5 text-right text-sm text-error">
      {errorPrecio}
    </p>
  {/if}

  <details class="group mt-3 border-t border-linea pt-1">
    <summary
      class="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg text-sm text-piedra [&::-webkit-details-marker]:hidden {focoRing}"
    >
      <ChevronRight
        class="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        aria-hidden="true"
      />
      {#if producto.variantes.length === 0}
        Sin opciones adicionales configuradas
      {:else}
        Opciones y variantes ({activas} {activas === 1 ? "activa" : "activas"})
      {/if}
    </summary>

    {#if producto.variantes.length > 0}
      <ul class="mt-1 grid max-w-2xl gap-2">
        {#each producto.variantes as variante (variante.id)}
          <li>
            <form
              method="POST"
              action="?/alternarVariante"
              class="flex items-center gap-3"
              use:enhance
            >
              <input type="hidden" name="productoId" value={producto.id} />
              <input type="hidden" name="varianteId" value={variante.id} />
              <label
                class="flex min-h-11 flex-1 cursor-pointer items-center gap-3 rounded-lg border border-linea bg-cal px-3 text-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-nopal"
              >
                <input
                  type="checkbox"
                  name="activa"
                  checked={variante.activa}
                  onchange={autoenviar}
                  class="size-4 accent-nopal"
                />
                <span class="min-w-0 flex-1">{variante.nombre}</span>
                <span class="font-semibold tabular-nums">+{formatMoney(variante.extraCents)}</span>
              </label>
              <noscript
                ><button type="submit" class="text-sm text-nopal underline">Guardar</button
                ></noscript
              >
            </form>
          </li>
        {/each}
      </ul>
    {/if}

    <details bind:this={detallesVariante} class="mt-1 max-w-2xl">
      <summary
        class="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-lg text-sm font-medium text-nopal [&::-webkit-details-marker]:hidden {focoRing}"
      >
        <Plus class="size-4" aria-hidden="true" />
        Agregar variante de tortilla o guarnición
      </summary>
      <form
        method="POST"
        action="?/agregarVariante"
        class="grid gap-3 rounded-xl bg-cal p-4 sm:grid-cols-[1fr_8rem_auto] sm:items-start"
        use:enhance={agregarVariante}
      >
        <input type="hidden" name="productoId" value={producto.id} />
        <div class="grid gap-1.5">
          <Label for="variante-nombre-{producto.id}">Nombre de la opción</Label>
          <Input
            id="variante-nombre-{producto.id}"
            name="nombre"
            autocomplete="off"
            value={errorVariante ? (propio?.values?.nombre ?? "") : ""}
            aria-invalid={errorVariante?.nombre ? "true" : undefined}
            aria-describedby={errorVariante?.nombre
              ? "variante-nombre-error-{producto.id}"
              : undefined}
          />
          {#if errorVariante?.nombre}
            <p id="variante-nombre-error-{producto.id}" class="text-sm text-error">
              {errorVariante.nombre}
            </p>
          {/if}
        </div>
        <div class="grid gap-1.5">
          <Label for="variante-extra-{producto.id}">Costo extra</Label>
          <Input
            id="variante-extra-{producto.id}"
            name="extra"
            inputmode="decimal"
            autocomplete="off"
            placeholder="0.00"
            value={errorVariante ? (propio?.values?.extra ?? "") : ""}
            aria-invalid={errorVariante?.extra ? "true" : undefined}
            aria-describedby={errorVariante?.extra
              ? "variante-extra-error-{producto.id}"
              : undefined}
          />
          {#if errorVariante?.extra}
            <p id="variante-extra-error-{producto.id}" class="text-sm text-error">
              {errorVariante.extra}
            </p>
          {/if}
        </div>
        <button
          type="submit"
          class="h-12 rounded-lg bg-nopal px-5 font-semibold text-white transition-colors hover:bg-nopal/90 sm:mt-5.5 {focoRing}"
        >
          Agregar opción
        </button>
      </form>
    </details>
  </details>
</li>
