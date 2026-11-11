<script lang="ts">
  import { enhance } from "$app/forms";
  import Save from "@lucide/svelte/icons/save";
  import Phone from "#lib/components/Phone.svelte";
  import MenuView from "#lib/components/MenuView.svelte";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import GuardarBoton from "./GuardarBoton.svelte";
  import type { ActionData, PageData } from "./$types";

  type Datos = Extract<PageData, { error: false }>;

  let {
    datos,
    form,
    negocio,
    categorias,
  }: {
    datos: Datos;
    form: ActionData;
    negocio: { nombre: string };
    categorias: Datos["categorias"];
  } = $props();

  const propio = $derived(form?.seccion === "tema" ? form : null);
  const errores = $derived(propio?.fieldErrors ?? {});

  // El estado local arranca con lo guardado (o con lo que el servidor rechazó, sin JavaScript).
  // svelte-ignore state_referenced_locally -- se inicializa una vez; después manda el usuario
  let preset = $state(propio?.values?.preset || datos.ajustes.tema.preset);
  // svelte-ignore state_referenced_locally -- idem
  let primario = $state(propio?.values?.primario || datos.ajustes.tema.primario);
  // svelte-ignore state_referenced_locally -- idem
  let fuente = $state(propio?.values?.fuente || datos.ajustes.tema.fuente);
  let enviando = $state(false);
  let tocado = $state(false);

  const presetActivo = $derived(datos.presets.find((p) => p.id === preset) ?? datos.presets[0]);
  const fuenteActiva = $derived(datos.fuentes.find((f) => f.id === fuente) ?? datos.fuentes[0]);
  const hexValido = $derived(/^#[0-9a-f]{6}$/i.test(primario.trim()));
  const guardado = $derived(!!propio?.ok && !tocado && !enviando);

  function elegirPreset(id: string) {
    const p = datos.presets.find((x) => x.id === id);
    if (!p) return;
    preset = p.id;
    primario = p.brand;
  }

  // Vista previa: mismas variables que el menú público (DESIGN.md §3.6), solo del tema del negocio.
  const vars = $derived.by(() => {
    const brand = hexValido ? primario.trim() : (presetActivo?.brand ?? primario);
    const bg = presetActivo?.bg ?? "transparent";
    const text = presetActivo?.text ?? "currentColor";
    return (
      `--brand:${brand};--brand-bg:${bg};--brand-text:${text};` +
      `--brand-muted:color-mix(in srgb,${text} 70%,${bg});` +
      `--brand-line:color-mix(in srgb,${text} 12%,${bg});` +
      `--brand-tint:color-mix(in srgb,${text} 8%,${bg});` +
      `font-family:${fuenteActiva?.familia ?? "inherit"}`
    );
  });
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link
    href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&family=Source+Serif+4:wght@400;600;700&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
  <form
    method="POST"
    action="?/tema"
    class="grid gap-8 rounded-xl border border-linea bg-white p-5 sm:p-6 lg:order-first"
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
      <legend class="text-base font-semibold">Preset visual predeterminado</legend>
      <div class="mt-3 grid gap-3 sm:grid-cols-3">
        {#each datos.presets as p (p.id)}
          <label class="relative block cursor-pointer">
            <input
              type="radio"
              name="preset"
              value={p.id}
              checked={preset === p.id}
              onchange={() => elegirPreset(p.id)}
              class="peer sr-only"
            />
            <span
              class="flex min-h-24 flex-col gap-1 rounded-lg border border-linea bg-white p-4 transition-colors hover:bg-cal peer-checked:border-nopal peer-checked:ring-2 peer-checked:ring-nopal/20 peer-focus-visible:ring-2 peer-focus-visible:ring-nopal/30"
            >
              <span class="flex items-center justify-between gap-2">
                <span class="text-base font-semibold">{p.nombre}</span>
                <span class="flex gap-1" aria-hidden="true">
                  <span class="size-3 rounded-full border border-linea" style:background={p.brand}
                  ></span>
                  <span class="size-3 rounded-full border border-linea" style:background={p.bg}
                  ></span>
                </span>
              </span>
              <span class="text-sm text-piedra">{p.descripcion}</span>
            </span>
          </label>
        {/each}
      </div>
      {#if errores.preset}
        <p class="mt-1.5 text-sm text-error" id="err-preset">{errores.preset}</p>
      {/if}
    </fieldset>

    <div>
      <Label for="primario" class="text-base font-semibold"
        >Color primario de acción (botones y destacados)</Label
      >
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <input
          type="color"
          aria-label="Selector de color primario"
          value={hexValido ? primario.trim() : (presetActivo?.brand ?? primario)}
          oninput={(e) => (primario = e.currentTarget.value.toUpperCase())}
          class="size-12 shrink-0 cursor-pointer rounded-lg border border-linea bg-white p-1 outline-none focus-visible:ring-2 focus-visible:ring-nopal/30"
        />
        <div class="relative min-w-40 flex-1">
          <span
            class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-sm text-piedra"
            aria-hidden="true">HEX</span
          >
          <Input
            id="primario"
            name="primario"
            bind:value={primario}
            autocomplete="off"
            spellcheck={false}
            maxlength={7}
            aria-invalid={errores.primario ? "true" : undefined}
            aria-describedby={errores.primario ? "err-primario" : "ayuda-primario"}
            class="pl-14 font-medium uppercase tabular-nums"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onclick={() => (primario = presetActivo?.brand ?? primario)}
          aria-label="Restablecer el color primario del preset"
        >
          Restablecer
        </Button>
      </div>
      {#if errores.primario}
        <p class="mt-1.5 text-sm text-error" id="err-primario">{errores.primario}</p>
      {/if}
      <p id="ayuda-primario" class="mt-2 text-sm text-piedra">
        Se usa en el selector de categoría activo, el botón de pedido y el selector de raciones.
      </p>
    </div>

    <fieldset class="min-w-0">
      <legend class="text-base font-semibold">Estilo tipográfico</legend>
      <div class="mt-3 grid grid-cols-3 gap-3">
        {#each datos.fuentes as f (f.id)}
          <label class="relative block cursor-pointer">
            <input
              type="radio"
              name="fuente"
              value={f.id}
              checked={fuente === f.id}
              onchange={() => (fuente = f.id)}
              class="peer sr-only"
            />
            <span
              class="flex min-h-20 flex-col items-center justify-center gap-0.5 rounded-lg border border-linea bg-white px-2 py-3 text-center transition-colors hover:bg-cal peer-checked:border-nopal peer-checked:ring-2 peer-checked:ring-nopal/20 peer-focus-visible:ring-2 peer-focus-visible:ring-nopal/30"
            >
              <span class="text-2xl font-semibold" style:font-family={f.familia} aria-hidden="true"
                >Aa</span
              >
              <span class="text-sm text-piedra">{f.nombre}</span>
            </span>
          </label>
        {/each}
      </div>
      {#if errores.fuente}
        <p class="mt-1.5 text-sm text-error">{errores.fuente}</p>
      {/if}
    </fieldset>

    <GuardarBoton etiqueta="Guardar cambios de tema" icono={Save} {enviando} {guardado} />
  </form>

  <details open class="lg:sticky lg:top-24 lg:order-last">
    <summary
      class="mb-4 flex min-h-11 cursor-pointer list-none items-center rounded-lg text-sm font-medium text-piedra outline-none focus-visible:ring-2 focus-visible:ring-nopal/30 lg:pointer-events-none [&::-webkit-details-marker]:hidden"
    >
      Vista previa en tiempo real
    </summary>
    <div class="flex justify-center">
      <Phone>
        <div style={vars} class="h-full overflow-hidden bg-(color:--brand-bg)">
          <MenuView
            preview
            negocio={{ nombre: negocio.nombre, abierto: true, cierra: "23:00", abre: "13:00" }}
            {categorias}
          />
        </div>
      </Phone>
    </div>
  </details>
</div>
