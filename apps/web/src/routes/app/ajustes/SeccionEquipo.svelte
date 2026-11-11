<script lang="ts">
  import { enhance } from "$app/forms";
  import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
  import Send from "@lucide/svelte/icons/send";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import type { ActionData, PageData } from "./$types";

  type Datos = Extract<PageData, { error: false }>;
  let { datos, form }: { datos: Datos; form: ActionData } = $props();

  const propio = $derived(form?.seccion === "equipo" ? form : null);
  const errores = $derived(propio?.fieldErrors ?? {});
  const nombreRol = (id: string) =>
    id === "dueno" ? "Admin total" : (datos.roles.find((r) => r.id === id)?.nombre ?? id);
  const iniciales = (nombre: string) =>
    nombre
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("");

  let invitando = $state(false);
  let correo = $state("");
  // svelte-ignore state_referenced_locally -- valor inicial del selector
  let rolInvitado = $state(datos.roles[1]?.id ?? "cocina");
  let enviando = $state<string | null>(null);

  function enviar(clave: string, alExito?: () => void) {
    return () => {
      enviando = clave;
      return async ({
        update,
        result,
      }: {
        update: () => Promise<void>;
        result: { type: string };
      }) => {
        await update();
        if (result.type === "success") alExito?.();
        enviando = null;
      };
    };
  }
</script>

<div class="grid gap-6 rounded-xl border border-linea bg-white p-5 sm:p-6">
  <form
    method="POST"
    action="?/invitar"
    class="grid gap-3 rounded-lg bg-cal p-4"
    use:enhance={() => {
      invitando = true;
      return async ({ update, result }) => {
        await update({ reset: false });
        if (result.type === "success") correo = "";
        invitando = false;
      };
    }}
  >
    <p class="text-base font-semibold">Invitar nuevo colaborador</p>
    <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem_auto]">
      <div class="min-w-0">
        <Label for="correo-invitado" class="sr-only">Correo del colaborador</Label>
        <Input
          id="correo-invitado"
          name="correo"
          type="email"
          autocomplete="off"
          placeholder="correo@taqueria.com"
          bind:value={correo}
          aria-invalid={errores.correo ? "true" : undefined}
          aria-describedby={errores.correo ? "err-correo" : undefined}
        />
        {#if errores.correo}
          <p class="mt-1.5 text-sm text-error" id="err-correo">{errores.correo}</p>
        {/if}
      </div>
      <div class="relative">
        <Label for="rol-invitado" class="sr-only">Rol del colaborador</Label>
        <span
          class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-sm text-piedra"
          aria-hidden="true">Rol:</span
        >
        <select
          id="rol-invitado"
          name="rol"
          bind:value={rolInvitado}
          class="h-12 w-full rounded-lg border border-linea bg-white pr-4 pl-12 text-base text-tinta outline-none focus-visible:border-nopal focus-visible:ring-2 focus-visible:ring-nopal/20"
        >
          {#each datos.roles as r (r.id)}
            <option value={r.id}>{r.nombre}</option>
          {/each}
        </select>
      </div>
      <Button
        type="submit"
        disabled={invitando}
        aria-busy={invitando}
        class="bg-tinta hover:bg-tinta/90"
      >
        <Send aria-hidden="true" />
        {invitando ? "Enviando…" : "Enviar invitación"}
      </Button>
    </div>
    <p role="status" aria-live="polite" class="text-sm font-medium text-nopal">
      {#if propio?.ok && propio.mensaje?.startsWith("Invitación")}{propio.mensaje}{/if}
    </p>
  </form>

  {#if errores.general}
    <p class="text-sm text-error" role="alert">{errores.general}</p>
  {/if}

  <ul class="divide-y divide-linea">
    {#each datos.ajustes.equipo as m (m.id)}
      {#snippet fila()}
        <span
          class="grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold {m.rol ===
          'dueno'
            ? 'bg-nopal text-white'
            : 'bg-linea text-tinta'}"
          aria-hidden="true">{iniciales(m.nombre)}</span
        >
        <span class="min-w-0 flex-1 text-left">
          <span class="flex flex-wrap items-center gap-2">
            <span class="text-base font-semibold break-words">{m.nombre}</span>
            {#if m.rol === "dueno"}
              <span class="rounded-full bg-nopal/10 px-2.5 py-0.5 text-sm font-medium text-nopal"
                >Dueño</span
              >
            {/if}
            {#if m.pendiente}
              <span class="rounded-full bg-cal px-2.5 py-0.5 text-sm text-piedra"
                >Invitación pendiente</span
              >
            {/if}
          </span>
          <span class="block text-sm break-all text-piedra">{m.correo}</span>
        </span>
        <span class="shrink-0 rounded-full bg-cal px-3 py-1 text-sm font-medium text-piedra"
          >{nombreRol(m.rol)}</span
        >
      {/snippet}

      <li>
        {#if m.rol === "dueno"}
          <div class="flex items-center gap-3 py-3">{@render fila()}</div>
        {:else}
          <details class="group">
            <summary
              class="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg py-3 outline-none focus-visible:ring-2 focus-visible:ring-nopal/30 [&::-webkit-details-marker]:hidden"
            >
              {@render fila()}
              <EllipsisVertical class="size-5 shrink-0 text-piedra" aria-hidden="true" />
              <span class="sr-only">Opciones de {m.nombre}</span>
            </summary>
            <div class="mb-3 grid gap-3 rounded-lg bg-cal p-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <form
                method="POST"
                action="?/rol"
                class="flex flex-wrap items-end gap-3"
                use:enhance={enviar(`rol-${m.id}`)}
              >
                <input type="hidden" name="id" value={m.id} />
                <div class="min-w-44 flex-1">
                  <Label for="rol-{m.id}" class="text-sm font-medium">Rol</Label>
                  <select
                    id="rol-{m.id}"
                    name="rol"
                    value={m.rol}
                    class="mt-2 h-12 w-full rounded-lg border border-linea bg-white px-4 text-base text-tinta outline-none focus-visible:border-nopal focus-visible:ring-2 focus-visible:ring-nopal/20"
                  >
                    {#each datos.roles as r (r.id)}
                      <option value={r.id}>{r.nombre}</option>
                    {/each}
                  </select>
                </div>
                <Button type="submit" variant="outline" disabled={enviando === `rol-${m.id}`}>
                  {enviando === `rol-${m.id}` ? "Guardando…" : "Cambiar rol"}
                </Button>
              </form>
              <form method="POST" action="?/quitar" use:enhance={enviar(`quitar-${m.id}`)}>
                <input type="hidden" name="id" value={m.id} />
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={enviando === `quitar-${m.id}`}
                >
                  {enviando === `quitar-${m.id}` ? "Quitando…" : "Quitar acceso"}
                </Button>
              </form>
            </div>
          </details>
        {/if}
      </li>
    {/each}
  </ul>

  {#if datos.ajustes.equipo.length === 1}
    <p class="text-sm text-piedra">
      Aún eres la única persona con acceso. Invita a tu equipo de cocina o de salón para repartir el
      trabajo.
    </p>
  {/if}

  <p role="status" aria-live="polite" class="text-sm font-medium text-nopal">
    {#if propio?.ok && propio.mensaje && !propio.mensaje.startsWith("Invitación")}{propio.mensaje}{/if}
  </p>
</div>
