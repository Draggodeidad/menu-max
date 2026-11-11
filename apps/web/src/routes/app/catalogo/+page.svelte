<script lang="ts">
  import { enhance, type SubmitFunction } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import Banknote from "@lucide/svelte/icons/banknote";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CloudCheck from "@lucide/svelte/icons/cloud-check";
  import Plus from "@lucide/svelte/icons/plus";
  import QrCode from "@lucide/svelte/icons/qr-code";
  import Shapes from "@lucide/svelte/icons/shapes";
  import type { PageProps } from "./$types";
  import { Button, buttonVariants } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import { cn } from "#lib/utils.js";
  import CategoriaSeccion from "./CategoriaSeccion.svelte";

  let { data, form }: PageProps = $props();

  const mensaje = $derived(form?.ok && "mensaje" in form ? form.mensaje : "");
  // Errores de una acción que no pertenecen a un campo (el campo muestra el suyo).
  const aviso = $derived(form && !form.ok && "error" in form ? form.error : "");
  const errorCategoria = $derived(
    form?.accion === "agregar-categoria" && "fieldErrors" in form ? form.fieldErrors : undefined,
  );
  const valorCategoria = $derived(
    form?.accion === "agregar-categoria" && "values" in form ? (form.values?.nombre ?? "") : "",
  );

  const resumen = $derived([
    {
      etiqueta: "Productos activos",
      valor: `${data.resumen.activos} / ${data.resumen.productos}`,
      icono: CircleCheck,
    },
    { etiqueta: "Categorías", valor: String(data.resumen.categorias), icono: Shapes },
    {
      etiqueta: "Sincronización",
      valor: data.resumen.sincronizado ? "En vivo" : "Sin conexión",
      icono: CloudCheck,
    },
    { etiqueta: "Moneda de cobro", valor: data.resumen.moneda, icono: Banknote },
  ]);

  let detallesCategoria: HTMLDetailsElement | undefined = $state();
  let reintentando = $state(false);
  async function reintentar() {
    reintentando = true;
    try {
      await invalidateAll();
    } finally {
      reintentando = false;
    }
  }

  const agregarCategoria: SubmitFunction = () => {
    return async ({ result, update }) => {
      await update();
      if (result.type === "success" && detallesCategoria) detallesCategoria.open = false;
    };
  };

  const focoRing =
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal";
</script>

<svelte:head>
  <title>Menú · MenusMax</title>
</svelte:head>

<main class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
  <div
    class="flex flex-col gap-4 border-b border-linea pb-6 sm:flex-row sm:items-start sm:justify-between"
  >
    <div>
      <h1 class="text-3xl font-bold tracking-[-0.03em]">Menú</h1>
      <p class="mt-1 max-w-prose text-base text-piedra">
        Edita tus productos y precios en línea. Los cambios se guardan de forma instantánea.
      </p>
    </div>
    <div class="flex flex-col gap-2 sm:flex-row">
      <Button href="/app/listo" variant="outline" class="w-full sm:w-auto">
        <QrCode aria-hidden="true" />
        Ver código QR
      </Button>
      <details bind:this={detallesCategoria} class="relative">
        <summary
          class={cn(
            buttonVariants(),
            "w-full cursor-pointer list-none sm:w-auto [&::-webkit-details-marker]:hidden",
            focoRing,
          )}
        >
          <Plus aria-hidden="true" />
          Agregar categoría
        </summary>
        <form
          method="POST"
          action="?/agregarCategoria"
          class="absolute top-full right-0 left-0 z-20 mt-2 grid gap-3 rounded-xl bg-white p-4 shadow-lg sm:left-auto sm:w-80"
          use:enhance={agregarCategoria}
        >
          <div class="grid gap-1.5">
            <Label for="nombre-categoria">Nombre de la categoría</Label>
            <Input
              id="nombre-categoria"
              name="nombre"
              autocomplete="off"
              placeholder="Postres"
              value={valorCategoria}
              aria-invalid={errorCategoria?.nombre ? "true" : undefined}
              aria-describedby={errorCategoria?.nombre ? "nombre-categoria-error" : undefined}
            />
            {#if errorCategoria?.nombre}
              <p id="nombre-categoria-error" class="text-sm text-error">{errorCategoria.nombre}</p>
            {/if}
          </div>
          <Button type="submit">Agregar categoría</Button>
        </form>
      </details>
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
  {#if aviso}
    <p
      role="alert"
      class="mt-4 rounded-xl border border-error bg-white px-4 py-3 text-sm text-error"
    >
      {aviso}
    </p>
  {/if}

  {#if data.error}
    <div role="alert" class="mt-6 rounded-xl border border-error bg-white p-6">
      <h2 class="text-xl font-semibold tracking-[-0.02em]">No pudimos cargar tu menú</h2>
      <p class="mt-1 text-base text-piedra">Revisa tu conexión y vuelve a intentarlo.</p>
      <Button class="mt-4" onclick={reintentar} disabled={reintentando}>
        {reintentando ? "Reintentando…" : "Reintentar"}
      </Button>
    </div>
  {:else}
    <dl
      class="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-linea bg-linea lg:grid-cols-4"
    >
      {#each resumen as dato (dato.etiqueta)}
        <div class="relative flex flex-col justify-center bg-white px-4 py-3 pr-11">
          <dt class="text-sm text-piedra">{dato.etiqueta}</dt>
          <dd class="mt-0.5 text-lg font-semibold tabular-nums">{dato.valor}</dd>
          <dato.icono
            class="absolute top-1/2 right-4 size-5 -translate-y-1/2 text-piedra"
            aria-hidden="true"
          />
        </div>
      {/each}
    </dl>

    {#if data.categorias.length === 0}
      <section class="mt-10 rounded-xl border border-dashed border-linea bg-white p-8 text-center">
        <h2 class="text-xl font-semibold tracking-[-0.02em]">Aún no hay productos</h2>
        <p class="mx-auto mt-1 max-w-prose text-base text-piedra">
          Agrega tu primera categoría para empezar a armar tu menú.
        </p>
      </section>
    {:else}
      {#each data.categorias as categoria, indice (categoria.id)}
        <CategoriaSeccion {categoria} {indice} total={data.categorias.length} resultado={form} />
      {/each}
    {/if}
  {/if}
</main>
