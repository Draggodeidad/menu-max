<script lang="ts">
  import { enhance, type SubmitFunction } from "$app/forms";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import CirclePlus from "@lucide/svelte/icons/circle-plus";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import type { CategoriaCatalogo, ResultadoCatalogo } from "#lib/server/demo.js";
  import ConfirmarEliminar from "./ConfirmarEliminar.svelte";
  import ProductoFila from "./ProductoFila.svelte";

  type Props = {
    categoria: CategoriaCatalogo;
    indice: number;
    total: number;
    resultado?: ResultadoCatalogo | null;
  };

  let { categoria, indice, total, resultado }: Props = $props();

  const propio = $derived(
    resultado?.id === categoria.id && resultado.accion === "agregar-producto"
      ? resultado
      : undefined,
  );
  const n = $derived(categoria.productos.length);

  let detalles: HTMLDetailsElement | undefined = $state();

  const agregarProducto: SubmitFunction = () => {
    return async ({ result, update }) => {
      await update();
      if (result.type === "success" && detalles) detalles.open = false;
    };
  };

  const focoRing =
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal";
  const botonIcono = `grid size-11 place-items-center rounded-lg text-piedra transition-colors hover:bg-cal hover:text-tinta disabled:opacity-40 disabled:hover:bg-transparent ${focoRing}`;
</script>

<section
  id="categoria-{categoria.id}"
  aria-labelledby="titulo-{categoria.id}"
  class="mt-10 scroll-mt-24"
>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
    <h2 id="titulo-{categoria.id}" class="text-xl font-semibold tracking-[-0.02em]">
      {categoria.nombre}
    </h2>
    <span
      class="rounded-full border border-linea bg-white px-2.5 py-0.5 text-sm font-medium text-piedra tabular-nums"
    >
      {n}
      {n === 1 ? "producto" : "productos"}
    </span>
    <div class="ml-auto flex items-center">
      <form method="POST" action="?/moverCategoria" class="flex" use:enhance>
        <input type="hidden" name="id" value={categoria.id} />
        <button
          type="submit"
          name="direccion"
          value="arriba"
          disabled={indice === 0}
          aria-label="Subir la categoría {categoria.nombre}"
          class={botonIcono}
        >
          <ArrowUp class="size-4" aria-hidden="true" />
        </button>
        <button
          type="submit"
          name="direccion"
          value="abajo"
          disabled={indice === total - 1}
          aria-label="Bajar la categoría {categoria.nombre}"
          class={botonIcono}
        >
          <ArrowDown class="size-4" aria-hidden="true" />
        </button>
      </form>
      <ConfirmarEliminar
        accion="?/eliminarCategoria"
        campos={{ id: categoria.id }}
        etiqueta="Eliminar la categoría {categoria.nombre}"
        titulo="¿Eliminar esta categoría?"
        detalle={n === 0
          ? `«${categoria.nombre}» saldrá de tu menú.`
          : `«${categoria.nombre}» y sus ${n} ${n === 1 ? "producto" : "productos"} saldrán de tu menú.`}
      />
    </div>
  </div>

  <ul class="mt-4 divide-y divide-linea rounded-xl border border-linea bg-white">
    {#each categoria.productos as producto (producto.id)}
      <ProductoFila {producto} {resultado} />
    {:else}
      <li class="px-4 py-6 text-sm text-piedra sm:px-5">
        Esta categoría no tiene productos. Agrega el primero.
      </li>
    {/each}

    <li>
      <details bind:this={detalles}>
        <summary
          class="flex min-h-14 cursor-pointer list-none items-center justify-center gap-2 rounded-b-xl text-base font-medium text-nopal transition-colors hover:bg-cal [&::-webkit-details-marker]:hidden {focoRing}"
        >
          <CirclePlus class="size-5" aria-hidden="true" />
          Agregar producto a {categoria.nombre}
        </summary>
        <form
          method="POST"
          action="?/agregarProducto"
          class="grid gap-3 rounded-b-xl border-t border-linea bg-cal px-4 py-4 sm:grid-cols-[1fr_9rem_auto] sm:items-start sm:px-5"
          use:enhance={agregarProducto}
        >
          <input type="hidden" name="categoriaId" value={categoria.id} />
          <div class="grid gap-1.5">
            <Label for="nombre-{categoria.id}">Nombre del producto</Label>
            <Input
              id="nombre-{categoria.id}"
              name="nombre"
              autocomplete="off"
              value={propio?.values?.nombre ?? ""}
              aria-invalid={propio?.fieldErrors?.nombre ? "true" : undefined}
              aria-describedby={propio?.fieldErrors?.nombre
                ? "nombre-error-{categoria.id}"
                : undefined}
            />
            {#if propio?.fieldErrors?.nombre}
              <p id="nombre-error-{categoria.id}" class="text-sm text-error">
                {propio.fieldErrors.nombre}
              </p>
            {/if}
          </div>
          <div class="grid gap-1.5">
            <Label for="precio-nuevo-{categoria.id}">Precio</Label>
            <Input
              id="precio-nuevo-{categoria.id}"
              name="precio"
              inputmode="decimal"
              autocomplete="off"
              placeholder="22.00"
              value={propio?.values?.precio ?? ""}
              aria-invalid={propio?.fieldErrors?.precio ? "true" : undefined}
              aria-describedby={propio?.fieldErrors?.precio
                ? "precio-nuevo-error-{categoria.id}"
                : undefined}
            />
            {#if propio?.fieldErrors?.precio}
              <p id="precio-nuevo-error-{categoria.id}" class="text-sm text-error">
                {propio.fieldErrors.precio}
              </p>
            {/if}
          </div>
          <button
            type="submit"
            class="h-12 rounded-lg bg-nopal px-5 font-semibold text-white transition-colors hover:bg-nopal/90 sm:mt-5.5 {focoRing}"
          >
            Agregar producto
          </button>
        </form>
      </details>
    </li>
  </ul>
</section>
