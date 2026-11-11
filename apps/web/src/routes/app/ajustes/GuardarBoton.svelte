<script lang="ts">
  import type Guardar from "@lucide/svelte/icons/save";
  import { fade } from "svelte/transition";
  import Check from "@lucide/svelte/icons/check";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import { Button } from "#lib/components/ui/button/index.js";

  let {
    etiqueta,
    icono: Icono,
    enviando,
    guardado,
    mensaje = "Guardado",
  }: {
    etiqueta: string;
    icono: typeof Guardar;
    enviando: boolean;
    guardado: boolean;
    mensaje?: string;
  } = $props();
</script>

<div class="flex flex-wrap items-center gap-3">
  <Button type="submit" disabled={enviando} aria-busy={enviando}>
    {#if enviando}
      <LoaderCircle class="motion-safe:animate-spin" aria-hidden="true" />
      Guardando…
    {:else}
      <Icono aria-hidden="true" />
      {etiqueta}
    {/if}
  </Button>
  <p role="status" aria-live="polite" class="min-h-6 text-sm font-medium text-nopal">
    {#if guardado}
      <span class="inline-flex items-center gap-1.5" transition:fade={{ duration: 150 }}>
        <Check class="size-4" aria-hidden="true" />
        {mensaje}
      </span>
    {/if}
  </p>
</div>
