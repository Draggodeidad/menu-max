<script lang="ts">
  import { enhance } from "$app/forms";
  import Download from "@lucide/svelte/icons/download";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import Info from "@lucide/svelte/icons/info";
  import Printer from "@lucide/svelte/icons/printer";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import type { ActionData, PageData } from "./$types";

  type Datos = Extract<PageData, { error: false }>;
  let { datos, form }: { datos: Datos; form: ActionData } = $props();

  const propio = $derived(form?.seccion === "qr" ? form : null);
  const error = $derived(propio?.fieldErrors?.mesas);
  // svelte-ignore state_referenced_locally -- se inicializa una vez; después manda el usuario
  let total = $state(propio?.values?.mesas || String(datos.ajustes.mesas));
  let formulario = $state<HTMLFormElement | null>(null);
  let listo = $state(false);
  $effect(() => {
    listo = true;
  });
</script>

<div class="flex flex-wrap items-center justify-between gap-3 print:hidden">
  <form
    bind:this={formulario}
    method="POST"
    action="?/mesas"
    class="flex items-center gap-3"
    use:enhance={() =>
      async ({ update }) =>
        update({ reset: false })}
  >
    <label for="mesas" class="text-sm text-piedra">Total mesas:</label>
    <div class="relative">
      <Input
        id="mesas"
        name="mesas"
        type="number"
        inputmode="numeric"
        min="1"
        max={datos.maxMesas}
        bind:value={total}
        onchange={() => formulario?.requestSubmit()}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? "err-mesas" : undefined}
        class="w-32 pr-16 tabular-nums"
      />
      <span
        class="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm text-piedra"
        aria-hidden="true">mesas</span
      >
    </div>
    <noscript><Button type="submit" variant="outline">Actualizar</Button></noscript>
  </form>
  {#if listo}
    <Button type="button" variant="outline" onclick={() => window.print()}>
      <Printer aria-hidden="true" />
      Imprimir todas (PDF)
    </Button>
  {/if}
</div>
{#if error}
  <p class="mt-1.5 text-sm text-error print:hidden" id="err-mesas" role="alert">{error}</p>
{/if}

{#if datos.mesas.length === 0}
  <p class="mt-6 max-w-prose text-base text-piedra">
    Aún no hay mesas. Escribe cuántas tiene tu salón para generar un código QR por cada una.
  </p>
{:else}
  <ul class="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4 print:grid-cols-3">
    {#each datos.mesas as mesa (mesa.n)}
      <li class="rounded-xl border border-linea bg-white p-3 print:break-inside-avoid">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold">Mesa {mesa.n}</h3>
          <span class="size-2 rounded-full bg-nopal" role="img" aria-label="Activa"></span>
        </div>
        <img
          src={mesa.src}
          width="132"
          height="132"
          alt="Código QR de la mesa {mesa.n}"
          class="mx-auto my-3 aspect-square w-full max-w-33 rounded-lg bg-cal p-1"
          loading="lazy"
          decoding="async"
        />
        <div class="flex items-center justify-between border-t border-linea pt-3 print:hidden">
          <a
            href={mesa.enlace}
            target="_blank"
            rel="noopener"
            class="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold whitespace-nowrap text-nopal outline-none hover:underline focus-visible:ring-2 focus-visible:ring-nopal/30"
          >
            Probar mesa
            <ExternalLink class="size-4" aria-hidden="true" />
            <span class="sr-only">{mesa.n} (se abre en una pestaña nueva)</span>
          </a>
          <a
            href={mesa.src}
            download="mesa-{mesa.n}.svg"
            aria-label="Descargar el QR de la mesa {mesa.n}"
            class="grid size-11 place-items-center rounded-lg text-piedra outline-none hover:bg-cal focus-visible:ring-2 focus-visible:ring-nopal/30"
          >
            <Download class="size-4" aria-hidden="true" />
          </a>
        </div>
      </li>
    {/each}
  </ul>
{/if}

<div class="mt-6 flex gap-3 rounded-xl bg-white p-5 text-sm print:hidden">
  <Info class="mt-0.5 size-5 shrink-0 text-nopal" aria-hidden="true" />
  <div>
    <p class="text-base font-semibold">Identificador automático de mesa</p>
    <p class="mt-1 max-w-prose leading-relaxed text-piedra">
      Al escanear, el cliente no necesita ingresar su mesa ni llamar al mesero para pedir la cuenta.
      Cada URL redirige automáticamente con el parámetro seguro
      <code class="rounded-md bg-cal px-1.5 py-0.5 text-tinta">?mesa=X</code>.
    </p>
  </div>
</div>
