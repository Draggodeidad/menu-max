<script lang="ts">
  import { tick } from "svelte";
  import { enhance } from "$app/forms";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import Plus from "@lucide/svelte/icons/plus";
  import Save from "@lucide/svelte/icons/save";
  import X from "@lucide/svelte/icons/x";
  import { Input } from "#lib/components/ui/input/index.js";
  import GuardarBoton from "./GuardarBoton.svelte";
  import type { ActionData, PageData } from "./$types";

  type Datos = Extract<PageData, { error: false }>;
  let { datos, form }: { datos: Datos; form: ActionData } = $props();

  type Fila = { id: string; nombre: string; costo: string };

  const propio = $derived(form?.seccion === "zonas" ? form : null);
  const errores = $derived(propio?.fieldErrors ?? {});

  // svelte-ignore state_referenced_locally -- se inicializa una vez; después manda el usuario
  let filas = $state<Fila[]>(
    datos.ajustes.zonas.map((z) => ({
      id: z.id,
      nombre: z.nombre,
      costo: (z.costoCents / 100).toFixed(2),
    })),
  );
  let contador = 0;
  let enviando = $state(false);
  let tocado = $state(false);
  const guardado = $derived(!!propio?.ok && !tocado && !enviando);
  let listo = $state(false);
  $effect(() => {
    listo = true;
  });
  let ultimo = $state<HTMLInputElement | null>(null);

  async function agregar() {
    filas = [...filas, { id: `nueva-${++contador}`, nombre: "", costo: "" }];
    tocado = true;
    await tick();
    ultimo?.focus();
  }
  function quitar(id: string) {
    filas = filas.filter((f) => f.id !== id);
    tocado = true;
  }
</script>

<form
  method="POST"
  action="?/zonas"
  class="grid gap-5 rounded-xl border border-linea bg-white p-5 sm:p-6"
  oninput={() => (tocado = true)}
  use:enhance={() => {
    enviando = true;
    tocado = false;
    return async ({ update }) => {
      await update({ reset: false });
      enviando = false;
    };
  }}
>
  {#if errores.general}
    <p class="text-sm text-error" role="alert">{errores.general}</p>
  {/if}

  {#if filas.length === 0}
    <p class="max-w-prose text-base text-piedra">
      Aún no hay zonas de entrega. Agrega la primera para recibir pedidos a domicilio.
    </p>
  {:else}
    <ul class="grid gap-3">
      {#each filas as fila, i (fila.id)}
        <li
          class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 rounded-lg bg-cal p-3 sm:grid-cols-[auto_minmax(0,1fr)_9rem_auto]"
        >
          <input type="hidden" name="id" value={fila.id} />
          <MapPin class="mt-3.5 hidden size-5 text-piedra sm:block" aria-hidden="true" />
          <div class="min-w-0">
            <Input
              name="nombre"
              bind:value={fila.nombre}
              bind:ref={ultimo}
              aria-label="Nombre de la zona {i + 1}"
              aria-invalid={errores[`nombre-${i}`] ? "true" : undefined}
              aria-describedby={errores[`nombre-${i}`] ? `err-nombre-${i}` : undefined}
              placeholder="Colonias de la zona"
            />
            {#if errores[`nombre-${i}`]}
              <p class="mt-1.5 text-sm text-error" id="err-nombre-{i}">{errores[`nombre-${i}`]}</p>
            {/if}
          </div>
          <button
            type="button"
            onclick={() => quitar(fila.id)}
            aria-label="Quitar la zona {fila.nombre || i + 1}"
            class="grid size-12 place-items-center rounded-lg text-piedra transition-colors outline-none hover:bg-white hover:text-error focus-visible:ring-2 focus-visible:ring-nopal/30 sm:order-last"
          >
            <X class="size-5" aria-hidden="true" />
          </button>
          <div class="col-span-2 min-w-0 sm:col-span-1">
            <div class="relative">
              <span
                class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-piedra"
                aria-hidden="true">$</span
              >
              <Input
                name="costo"
                inputmode="decimal"
                bind:value={fila.costo}
                aria-label="Costo de envío de la zona {fila.nombre || i + 1}"
                aria-invalid={errores[`costo-${i}`] ? "true" : undefined}
                aria-describedby={errores[`costo-${i}`] ? `err-costo-${i}` : undefined}
                class="pl-8 text-right tabular-nums"
              />
            </div>
            {#if errores[`costo-${i}`]}
              <p class="mt-1.5 text-sm text-error" id="err-costo-{i}">{errores[`costo-${i}`]}</p>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if listo}
    <button
      type="button"
      onclick={agregar}
      class="inline-flex min-h-11 items-center gap-2 justify-self-start rounded-lg text-base font-semibold text-nopal outline-none hover:underline focus-visible:ring-2 focus-visible:ring-nopal/30"
    >
      <Plus class="size-5" aria-hidden="true" />
      Agregar otra zona de entrega
    </button>
  {/if}

  <div class="border-t border-linea pt-5">
    <GuardarBoton etiqueta="Guardar zonas de entrega" icono={Save} {enviando} {guardado} />
  </div>
</form>
