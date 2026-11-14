<script lang="ts">
  import { enhance } from "$app/forms";
  import { ArrowLeft, Eye, EyeOff } from "@lucide/svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import type { PageProps } from "./$types";

  let { data, form }: PageProps = $props();
  let enviando = $state(false);
  let mostrarContrasena = $state(false);
</script>

<svelte:head>
  <title
    >{data.returningToInvitation ? "Entrar para aceptar tu invitación" : "Entrar a tu panel"} | MenusMax</title
  >
  {#if data.returningToInvitation}<meta name="referrer" content="no-referrer" />{/if}
  <meta
    name="description"
    content="Entra a tu panel de MenusMax para gestionar tu menú y pedidos."
  />
</svelte:head>

<main class="flex min-h-screen items-center justify-center bg-cal px-4 py-12">
  <div class="w-full max-w-sm">
    <section
      aria-labelledby="titulo"
      class="rounded-xl border border-linea bg-background p-6 sm:p-8"
    >
      <a
        href="/"
        class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-piedra hover:text-tinta focus-visible:rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal"
      >
        <ArrowLeft size={16} aria-hidden="true" /> MenusMax
      </a>

      <h1 id="titulo" class="mt-3 text-3xl font-bold tracking-tight">
        {data.returningToInvitation ? "Entra a tu cuenta" : "Entra a tu panel"}
      </h1>
      <p class="mt-1 text-sm leading-relaxed text-piedra">
        {data.returningToInvitation
          ? "Usa el correo que recibió la invitación."
          : "Gestiona tus pedidos en tiempo real, menú y ajustes."}
      </p>

      <form
        method="POST"
        novalidate
        class="mt-6 space-y-4"
        use:enhance={() => {
          enviando = true;
          return async ({ update }) => {
            await update();
            enviando = false;
            document.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
          };
        }}
      >
        <div class="space-y-2">
          <Label for="correo">Correo electrónico</Label>
          <Input
            id="correo"
            name="correo"
            type="email"
            autocomplete="email"
            placeholder="tu@negocio.com"
            value={form?.values?.correo ?? ""}
            aria-invalid={!!form?.fieldErrors?.correo}
            aria-describedby={form?.fieldErrors?.correo ? "correo-error" : undefined}
            required
          />
          {#if form?.fieldErrors?.correo}<p id="correo-error" class="text-sm text-error">
              {form.fieldErrors.correo}
            </p>{/if}
        </div>

        <div class="space-y-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <Label for="contrasena">Contraseña</Label>
            <button
              type="button"
              disabled
              aria-describedby="recuperacion-pendiente"
              class="text-sm font-medium text-piedra disabled:cursor-not-allowed"
              >¿Olvidaste tu contraseña?</button
            >
          </div>
          <p id="recuperacion-pendiente" class="sr-only">
            La recuperación de contraseña aún no está disponible.
          </p>
          <div class="relative">
            <Input
              id="contrasena"
              name="contrasena"
              type={mostrarContrasena ? "text" : "password"}
              autocomplete="current-password"
              placeholder="••••••••"
              class="pr-12"
              aria-invalid={!!form?.fieldErrors?.contrasena}
              aria-describedby={form?.fieldErrors?.contrasena ? "contrasena-error" : undefined}
              required
            />
            <button
              type="button"
              aria-label={mostrarContrasena ? "Ocultar contraseña" : "Mostrar contraseña"}
              aria-pressed={mostrarContrasena}
              onclick={() => (mostrarContrasena = !mostrarContrasena)}
              class="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-lg text-piedra hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal"
            >
              {#if mostrarContrasena}<EyeOff size={18} aria-hidden="true" />{:else}<Eye
                  size={18}
                  aria-hidden="true"
                />{/if}
            </button>
          </div>
          {#if form?.fieldErrors?.contrasena}<p id="contrasena-error" class="text-sm text-error">
              {form.fieldErrors.contrasena}
            </p>{/if}
        </div>

        <Button type="submit" disabled={enviando} class="mt-2 w-full"
          >{enviando ? "Entrando…" : "Entrar"}</Button
        >
      </form>

      {#if !data.returningToInvitation}
        <p class="mt-6 border-t border-linea pt-5 text-center text-sm text-piedra">
          ¿No tienes cuenta? <a
            href="/crear"
            class="font-semibold text-nopal underline-offset-4 hover:underline focus-visible:rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal"
            >Crea tu menú</a
          >
        </p>
      {/if}
    </section>
    <p class="mt-8 text-center text-sm text-piedra">
      Sistema operativo para comercio gastronómico · México
    </p>
  </div>
</main>
