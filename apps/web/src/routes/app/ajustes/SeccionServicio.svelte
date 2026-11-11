<script lang="ts">
  import { enhance } from "$app/forms";
  import Save from "@lucide/svelte/icons/save";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import GuardarBoton from "./GuardarBoton.svelte";
  import type { ActionData, PageData } from "./$types";

  type Datos = Extract<PageData, { error: false }>;
  let { datos, form }: { datos: Datos; form: ActionData } = $props();

  const propio = $derived(form?.seccion === "servicio" ? form : null);
  const errores = $derived(propio?.fieldErrors ?? {});
  const s = $derived(datos.ajustes.servicio);
  const v = $derived(propio?.values);

  // svelte-ignore state_referenced_locally -- el valor inicial sale de lo guardado o de lo rechazado
  let abre = $state(v?.abre || s.abre);
  // svelte-ignore state_referenced_locally -- idem
  let cierra = $state(v?.cierra || s.cierra);
  // svelte-ignore state_referenced_locally -- idem
  let tiempo = $state(v?.tiempo || String(s.tiempoMin));
  let enviando = $state(false);
  let tocado = $state(false);
  const guardado = $derived(!!propio?.ok && !tocado && !enviando);

  const canales = $derived([
    {
      id: "mesa",
      titulo: "En mesa (código QR)",
      detalle: "Pedido directo en salón",
      on: v ? !!v.mesa : s.mesa,
    },
    {
      id: "recoger",
      titulo: "Recoger en mostrador",
      detalle: "Pick-up con folio express",
      on: v ? !!v.recoger : s.recoger,
    },
    {
      id: "domicilio",
      titulo: "A domicilio",
      detalle: "Repartidores de la taquería",
      on: v ? !!v.domicilio : s.domicilio,
    },
  ]);
</script>

<form
  method="POST"
  action="?/servicio"
  class="grid gap-6 rounded-xl border border-linea bg-white p-5 sm:p-6"
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
  <fieldset class="min-w-0">
    <legend class="text-base font-semibold">Canales de pedido habilitados</legend>
    <div
      class="mt-3 grid gap-3 md:grid-cols-3"
      aria-describedby={errores.canales ? "err-canales" : undefined}
    >
      {#each canales as c (c.id)}
        <label
          class="relative flex min-h-20 cursor-pointer items-center justify-between gap-3 rounded-lg bg-cal p-4"
        >
          <span class="min-w-0">
            <span class="block text-base font-semibold">{c.titulo}</span>
            <span class="block text-sm text-piedra">{c.detalle}</span>
          </span>
          <input type="checkbox" role="switch" name={c.id} checked={c.on} class="peer sr-only" />
          <span
            class="relative h-6 w-11 shrink-0 rounded-full bg-linea transition-colors peer-checked:bg-nopal peer-focus-visible:ring-2 peer-focus-visible:ring-nopal/30 peer-focus-visible:ring-offset-2 peer-checked:[&>span]:translate-x-5"
            aria-hidden="true"
          >
            <span
              class="absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform motion-reduce:transition-none"
            ></span>
          </span>
        </label>
      {/each}
    </div>
    {#if errores.canales}
      <p class="mt-1.5 text-sm text-error" id="err-canales" role="alert">{errores.canales}</p>
    {/if}
  </fieldset>

  <div class="grid gap-4 border-t border-linea pt-6 sm:grid-cols-3">
    <div>
      <Label for="abre" class="text-sm font-medium">Hora de apertura</Label>
      <Input
        id="abre"
        name="abre"
        type="time"
        bind:value={abre}
        class="mt-2"
        aria-invalid={errores.abre ? "true" : undefined}
        aria-describedby={errores.abre ? "err-abre" : undefined}
      />
      {#if errores.abre}<p class="mt-1.5 text-sm text-error" id="err-abre">{errores.abre}</p>{/if}
    </div>
    <div>
      <Label for="cierra" class="text-sm font-medium">Hora de cierre</Label>
      <Input
        id="cierra"
        name="cierra"
        type="time"
        bind:value={cierra}
        class="mt-2"
        aria-invalid={errores.cierra ? "true" : undefined}
        aria-describedby={errores.cierra ? "err-cierra" : undefined}
      />
      {#if errores.cierra}
        <p class="mt-1.5 text-sm text-error" id="err-cierra">{errores.cierra}</p>
      {/if}
    </div>
    <div>
      <Label for="tiempo" class="text-sm font-medium">Tiempo promedio cocina</Label>
      <div class="relative mt-2">
        <Input
          id="tiempo"
          name="tiempo"
          type="number"
          inputmode="numeric"
          min="1"
          max="180"
          bind:value={tiempo}
          class="pr-20 tabular-nums"
          aria-invalid={errores.tiempo ? "true" : undefined}
          aria-describedby={errores.tiempo ? "err-tiempo" : undefined}
        />
        <span
          class="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm text-piedra"
          aria-hidden="true">minutos</span
        >
      </div>
      {#if errores.tiempo}
        <p class="mt-1.5 text-sm text-error" id="err-tiempo">{errores.tiempo}</p>
      {/if}
    </div>
  </div>

  <GuardarBoton etiqueta="Guardar horarios y modalidades" icono={Save} {enviando} {guardado} />
</form>
