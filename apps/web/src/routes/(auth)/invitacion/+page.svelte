<script lang="ts">
  import { enhance } from "$app/forms";
  import { ArrowLeft } from "@lucide/svelte";
  import type { InvitationPreviewDto } from "@menu-max/contracts";
  import { tick } from "svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import type { PageProps } from "./$types";

  const roleLabels = {
    owner: "dueño",
    admin: "administrador",
    staff: "personal",
  } satisfies Record<InvitationPreviewDto["role"], string>;
  const keyboardFocus =
    "motion-reduce:transition-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal";

  let { data, form }: PageProps = $props();
  let submitting = $state(false);
  let notice = $state<HTMLParagraphElement>();
  const errors = $derived(form?.fieldErrors);
  const nameError = $derived(errors?.name?.[0]);
  const passwordError = $derived(errors?.password?.[0]);
  const turnstileError = $derived(errors?.turnstileToken?.[0]);
  const needsSignIn = $derived(
    form?.needsSignIn || (!data.hasSession && data.invitation?.accountExists),
  );
</script>

<svelte:head>
  <title>Invitación a un equipo | MenusMax</title>
  <meta name="description" content="Acepta tu invitación para unirte a un equipo en MenusMax." />
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<main class="flex min-h-screen items-center justify-center bg-cal px-4 py-12">
  <section
    aria-labelledby="invitation-title"
    class="w-full max-w-sm rounded-xl border border-linea bg-background p-6 sm:p-8"
  >
    {#if data.invitation}
      <a
        href="/"
        class="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-piedra hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal"
      >
        <ArrowLeft size={16} aria-hidden="true" /> MenusMax
      </a>
      <h1 id="invitation-title" class="mt-3 text-3xl font-bold tracking-[-0.03em] wrap-anywhere">
        Únete a {data.invitation.orgName}
      </h1>

      <dl
        class="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-y border-linea py-3 text-sm"
      >
        <dt class="text-piedra">Rol</dt>
        <dd class="font-medium">{roleLabels[data.invitation.role]}</dd>
        <dt class="text-piedra">Correo invitado</dt>
        <dd class="font-medium wrap-anywhere">{data.invitation.emailMasked}</dd>
      </dl>

      {#if data.invitation.expired}
        <p class="mt-5 text-sm leading-relaxed text-error">{data.message}</p>
      {:else}
        {#if form?.message && !errors}
          <p
            bind:this={notice}
            role="alert"
            tabindex="-1"
            class="mt-5 rounded-lg bg-error/5 px-3 py-2 text-sm leading-relaxed text-error focus:outline-2 focus:outline-offset-2 focus:outline-error"
          >
            {form.message}
          </p>
        {/if}

        {#if needsSignIn}
          {#if !form?.message}
            <p class="mt-5 text-sm leading-relaxed text-piedra">{data.message}</p>
          {/if}
          <Button
            href={data.signInHref}
            data-sveltekit-preload-data={false}
            class={["mt-4 w-full", keyboardFocus]}
          >
            Entrar
          </Button>
        {:else}
          <form
            method="POST"
            action={data.acceptAction}
            novalidate
            class="mt-5 space-y-4"
            aria-busy={submitting}
            use:enhance={({ formElement, cancel }) => {
              if (submitting) {
                cancel();
                return;
              }
              submitting = true;
              return async ({ result, update }) => {
                try {
                  await update();
                  if (result.type === "failure") {
                    await tick();
                    (
                      formElement.querySelector<HTMLElement>(
                        '[aria-invalid="true"], [data-turnstile-error]',
                      ) ?? notice
                    )?.focus();
                  }
                } finally {
                  submitting = false;
                }
              };
            }}
          >
            {#if !data.hasSession}
              <p class="text-sm leading-relaxed text-piedra">
                Crea tu cuenta para unirte al equipo.
              </p>
              <div class="space-y-2">
                <Label for="invitation-name">Nombre</Label>
                <Input
                  id="invitation-name"
                  name="name"
                  type="text"
                  autocomplete="name"
                  class={["border-piedra/80", keyboardFocus]}
                  maxlength={120}
                  value={form?.values?.name ?? ""}
                  aria-invalid={!!nameError}
                  aria-describedby={nameError ? "invitation-name-error" : undefined}
                  required
                />
                {#if nameError}
                  <p id="invitation-name-error" class="text-sm text-error">{nameError}</p>
                {/if}
              </div>

              <div class="space-y-2">
                <Label for="invitation-password">Contraseña</Label>
                <Input
                  id="invitation-password"
                  name="password"
                  type="password"
                  autocomplete="new-password"
                  class={["border-piedra/80", keyboardFocus]}
                  minlength={10}
                  maxlength={128}
                  aria-invalid={!!passwordError}
                  aria-describedby={passwordError
                    ? "invitation-password-error"
                    : "invitation-password-hint"}
                  required
                />
                {#if passwordError}
                  <p id="invitation-password-error" class="text-sm text-error">{passwordError}</p>
                {:else}
                  <p id="invitation-password-hint" class="text-sm text-piedra">
                    De 10 a 128 caracteres.
                  </p>
                {/if}
              </div>

              <!-- TEMPORAL: el widget de Turnstile irá aquí al conectar la API. -->
              {#if turnstileError}
                <p
                  data-turnstile-error
                  role="alert"
                  tabindex="-1"
                  class="rounded-lg bg-error/5 px-3 py-2 text-sm text-error focus:outline-2 focus:outline-offset-2 focus:outline-error"
                >
                  {turnstileError}
                </p>
              {/if}
            {/if}
            <Button type="submit" disabled={submitting} class={["w-full", keyboardFocus]}>
              {submitting ? "Aceptando…" : "Aceptar invitación"}
            </Button>
          </form>
        {/if}
      {/if}
    {:else}
      <h1 id="invitation-title" class="text-3xl font-bold tracking-[-0.03em]">
        Invitación no válida
      </h1>
      <p class="mt-2 text-sm leading-relaxed text-piedra">{data.message}</p>
      <Button href="/" variant="outline" class={["mt-5 w-full", keyboardFocus]}>
        Volver al inicio
      </Button>
    {/if}
  </section>
</main>
