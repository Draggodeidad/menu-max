<script lang="ts">
  import { enhance } from "$app/forms";
  import Trash2 from "@lucide/svelte/icons/trash-2";

  type Props = {
    /** Form action que elimina, p. ej. `?/eliminar`. */
    accion: string;
    /** Campos ocultos que viajan con el formulario (solo ids). */
    campos: Record<string, string>;
    /** Nombre accesible del botón que abre la confirmación. */
    etiqueta: string;
    titulo: string;
    detalle: string;
  };

  let { accion, campos, etiqueta, titulo, detalle }: Props = $props();

  let detalles: HTMLDetailsElement | undefined = $state();
  let enviando = $state(false);

  const focoRing =
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal";

  function cerrar() {
    if (detalles) detalles.open = false;
  }
</script>

<!-- Confirmación nativa (<details>): funciona sin JavaScript. -->
<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && detalles?.open) {
      cerrar();
      detalles.querySelector("summary")?.focus();
    }
  }}
/>

<details bind:this={detalles} class="relative">
  <summary
    aria-label={etiqueta}
    class="grid size-11 cursor-pointer list-none place-items-center rounded-lg text-piedra transition-colors hover:bg-cal hover:text-error [&::-webkit-details-marker]:hidden {focoRing}"
  >
    <Trash2 class="size-4" aria-hidden="true" />
  </summary>
  <div
    class="absolute top-full right-0 z-20 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-xl bg-white p-4 text-left shadow-lg"
  >
    <p class="text-base font-semibold">{titulo}</p>
    <p class="mt-1 text-sm text-piedra">{detalle}</p>
    <form
      method="POST"
      action={accion}
      class="mt-4 flex gap-2"
      use:enhance={() => {
        enviando = true;
        return async ({ update }) => {
          await update();
          enviando = false;
          cerrar();
        };
      }}
    >
      {#each Object.entries(campos) as [nombre, valor] (nombre)}
        <input type="hidden" name={nombre} value={valor} />
      {/each}
      <button
        type="button"
        onclick={cerrar}
        class="h-11 flex-1 rounded-lg border border-linea bg-white text-base font-medium transition-colors hover:bg-cal {focoRing}"
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={enviando}
        class="h-11 flex-1 rounded-lg bg-error text-base font-semibold text-white transition-colors hover:bg-error/90 disabled:opacity-50 {focoRing}"
      >
        {enviando ? "Eliminando…" : "Eliminar"}
      </button>
    </form>
  </div>
</details>
