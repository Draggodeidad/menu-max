<script lang="ts">
  import { enhance } from "$app/forms";
  import { page } from "$app/state";
  import MenuView from "#lib/components/MenuView.svelte";
  import Phone from "#lib/components/Phone.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import { parseMoneyToCents } from "#lib/money.js";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import { onMount } from "svelte";
  import type { PageProps } from "./$types";

  type Producto = { id: number; nombre: string; precio: string };
  let { data, form }: PageProps = $props();
  const errores = $derived<Record<string, string>>(form?.fieldErrors ?? {});

  /* svelte-ignore state_referenced_locally -- valores iniciales; el estado local los edita */
  const inicial = form?.values;
  /* svelte-ignore state_referenced_locally */
  let nombre = $state(inicial?.nombre ?? page.url.searchParams.get("nombre") ?? "");
  /* svelte-ignore state_referenced_locally */
  let productos = $state<Producto[]>(
    (inicial?.productos ?? data.productosEjemplo).map((p, i) => ({ id: i + 1, ...p })),
  );
  /* svelte-ignore state_referenced_locally */
  let modalidades = $state<string[]>(inicial?.modalidades ?? ["recoger"]);
  /* svelte-ignore state_referenced_locally */
  let whatsapp = $state(inicial?.whatsapp ?? "");
  /* svelte-ignore state_referenced_locally */
  let correo = $state(inicial?.correo ?? "");
  let enviando = $state(false);
  // svelte-ignore state_referenced_locally
  let siguienteId = productos.length + 1;
  let listo = $state(false);
  let slug = $derived(
    nombre
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
  );

  // Misma estructura que el menú público para que la vista previa use `MenuView`.
  const categoriasPrevia = $derived([
    {
      id: "menu",
      nombre: "Menú principal",
      productos: productos.flatMap((p) => {
        const precioCents = parseMoneyToCents(p.precio);
        return p.nombre.trim() && precioCents !== null
          ? [{ id: String(p.id), nombre: p.nombre.trim(), precioCents }]
          : [];
      }),
    },
  ]);
  const vars = $derived(
    `--brand:${data.tema.brand};--brand-bg:${data.tema.bg};--brand-text:${data.tema.text};` +
      `--brand-muted:color-mix(in srgb,${data.tema.text} 70%,${data.tema.bg});` +
      `--brand-line:color-mix(in srgb,${data.tema.text} 12%,${data.tema.bg});` +
      `--brand-tint:color-mix(in srgb,${data.tema.text} 8%,${data.tema.bg})`,
  );

  // Se restaura una sola vez al montar. Con $effect el efecto leía y escribía
  // `productos` a la vez, y con un borrador guardado entraba en un bucle infinito.
  // Si el servidor devolvió valores (error de validación), esos mandan sobre el borrador.
  onMount(() => {
    try {
      const guardado = form?.values ? null : localStorage.getItem("menusmax-borrador");
      if (guardado) {
        const borrador = JSON.parse(guardado);
        if (!page.url.searchParams.has("nombre") && typeof borrador.nombre === "string")
          nombre = borrador.nombre;
        if (
          Array.isArray(borrador.productos) &&
          borrador.productos.every(
            (p: Producto) =>
              typeof p.id === "number" &&
              typeof p.nombre === "string" &&
              typeof p.precio === "string",
          )
        ) {
          productos = borrador.productos;
          siguienteId = Math.max(0, ...productos.map((p) => p.id)) + 1;
        }
        if (Array.isArray(borrador.modalidades))
          modalidades = borrador.modalidades.filter(
            (m: unknown): m is string =>
              typeof m === "string" && ["mesa", "recoger", "domicilio"].includes(m),
          );
        if (typeof borrador.whatsapp === "string") whatsapp = borrador.whatsapp;
      }
    } catch {
      /* El formulario sigue disponible si el almacenamiento falla. */
    }
    listo = true;
  });

  $effect(() => {
    if (!listo) return;
    try {
      localStorage.setItem(
        "menusmax-borrador",
        JSON.stringify({ nombre, productos, modalidades, whatsapp }),
      );
    } catch {
      /* El formulario sigue disponible si el almacenamiento falla. */
    }
  });

  // Foco en el primer campo con error tras un envío fallido (mejora progresiva).
  $effect(() => {
    if (form?.fieldErrors) document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
  });
</script>

<svelte:head>
  <title>Crea tu menú · MenusMax</title>
  <meta name="description" content="Arma el menú digital de tu negocio en MenusMax." />
</svelte:head>

{#snippet vistaPrevia()}
  <div class="flex flex-col items-center">
    <Phone>
      <div style={vars} class="h-full overflow-hidden bg-(color:--brand-bg)">
        <MenuView
          preview
          negocio={{
            nombre: nombre.trim() || "Tu negocio",
            abierto: true,
            cierra: "23:00",
            abre: "09:00",
          }}
          categorias={categoriasPrevia}
        />
      </div>
    </Phone>
    <p class="mt-4 max-w-[30ch] text-center text-sm text-piedra">
      Así se verá tu menú para tus clientes.
    </p>
  </div>
{/snippet}

{#snippet msg(id: string)}
  {#if errores[id]}
    <p id="error-{id}" class="mt-1.5 text-sm text-error">{errores[id]}</p>
  {/if}
{/snippet}

<header class="border-b border-linea bg-white">
  <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
    <a href="/" class="text-xl font-bold tracking-[-0.03em]">MenusMax</a>
    <Button href="/entrar" variant="outline" class="h-11 px-5 text-sm">Entrar</Button>
  </div>
</header>

<main class="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
  <details open class="mb-8 lg:hidden">
    <summary
      class="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-linea bg-white px-4 py-3 font-semibold focus-visible:ring-2 focus-visible:ring-nopal/30 focus-visible:outline-none [&::-webkit-details-marker]:hidden"
    >
      Vista previa de tu menú
      <ChevronDown class="size-5 text-piedra" aria-hidden="true" />
    </summary>
    <div class="pt-6">{@render vistaPrevia()}</div>
  </details>
  <div class="grid items-start gap-12 lg:grid-cols-[minmax(0,560px)_1fr]">
    <section class="rounded-xl border border-linea bg-white p-5 sm:p-8">
      <h1 class="text-3xl font-bold tracking-[-0.03em]">Arma tu menú digital</h1>
      <p class="mt-2 text-sm text-piedra">
        Configura tus productos y prepara tu menú para publicarlo.
      </p>
      <form
        method="POST"
        action="?/publicar"
        class="mt-8"
        novalidate
        use:enhance={() => {
          enviando = true;
          return async ({ update }) => {
            await update({ reset: false });
            enviando = false;
          };
        }}
      >
        <div>
          <Label for="nombre" class="font-semibold">Nombre de tu negocio</Label>
          <Input
            id="nombre"
            name="nombre"
            autocomplete="organization"
            bind:value={nombre}
            placeholder="Nombre de tu negocio"
            aria-invalid={errores.nombre ? "true" : undefined}
            aria-describedby={errores.nombre ? "error-nombre" : undefined}
            class="mt-2"
          />
          {@render msg("nombre")}
        </div>
        <div class="mt-5">
          <p class="text-sm font-semibold">Enlace de tu menú</p>
          <p class="mt-2 break-all rounded-lg border border-linea px-4 py-3 text-sm text-piedra">
            menusmax.mx/m/<span class="text-tinta">{slug || "tu-negocio"}</span>
          </p>
        </div>
        <fieldset class="mt-10">
          <legend class="text-xl font-semibold tracking-[-0.02em]">Productos y precios</legend>
          <p class="mt-1 text-sm text-piedra">
            Agrega los productos de tu menú y sus precios en pesos MXN.
          </p>
          <div class="mt-3 space-y-2">
            {#each productos as producto, i (producto.id)}
              <div class="flex gap-2">
                <Label class="sr-only" for="producto-{producto.id}"
                  >Nombre del producto {i + 1}</Label
                >
                <Input
                  id="producto-{producto.id}"
                  name="productoNombre"
                  bind:value={producto.nombre}
                  aria-invalid={errores[`producto-${i}`] ? "true" : undefined}
                  aria-describedby={errores[`producto-${i}`] ? `error-producto-${i}` : undefined}
                  placeholder="Nombre del producto"
                  class="min-w-0 flex-1 px-3 text-sm"
                />
                <Label class="sr-only" for="precio-{producto.id}">Precio del producto {i + 1}</Label
                >
                <Input
                  id="precio-{producto.id}"
                  name="productoPrecio"
                  bind:value={producto.precio}
                  type="text"
                  inputmode="decimal"
                  aria-invalid={errores[`precio-${i}`] ? "true" : undefined}
                  aria-describedby={errores[`precio-${i}`] ? `error-precio-${i}` : undefined}
                  placeholder="$ 0.00"
                  class="w-24 px-3 text-sm tabular-nums sm:w-32"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  class="size-12 text-piedra"
                  aria-label="Quitar producto {i + 1}"
                  onclick={() => (productos = productos.filter((p) => p.id !== producto.id))}
                >
                  <X class="size-5" aria-hidden="true" />
                </Button>
              </div>
              {@render msg(`producto-${i}`)}
              {@render msg(`precio-${i}`)}
            {/each}
          </div>
          {@render msg("productos")}
          <Button
            type="button"
            variant="outline"
            class="mt-4 h-11 text-sm"
            onclick={() =>
              (productos = [...productos, { id: siguienteId++, nombre: "", precio: "" }])}
          >
            <Plus class="size-4" aria-hidden="true" /> Agregar producto
          </Button>
        </fieldset>
        <fieldset class="mt-10">
          <legend class="text-xl font-semibold tracking-[-0.02em]">Cómo entregas tus pedidos</legend
          >
          <div class="mt-3 flex flex-wrap gap-2">
            {#each [{ valor: "mesa", etiqueta: "Mesa (en el local)" }, { valor: "recoger", etiqueta: "Para recoger" }, { valor: "domicilio", etiqueta: "A domicilio" }] as modalidad (modalidad.valor)}
              <label
                ><input
                  type="checkbox"
                  name="modalidad"
                  value={modalidad.valor}
                  bind:group={modalidades}
                  class="peer sr-only"
                /><span
                  class="inline-flex min-h-11 items-center rounded-full border border-linea px-4 text-sm font-medium peer-checked:border-nopal peer-checked:bg-nopal peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-nopal/30"
                  >{modalidad.etiqueta}</span
                ></label
              >
            {/each}
          </div>
          {@render msg("modalidades")}
        </fieldset>
        <div class="mt-10">
          <Label for="whatsapp" class="font-semibold">WhatsApp para recibir pedidos</Label>
          <Input
            id="whatsapp"
            name="whatsapp"
            type="tel"
            aria-invalid={errores.whatsapp ? "true" : undefined}
            aria-describedby={errores.whatsapp ? "error-whatsapp" : undefined}
            autocomplete="tel"
            bind:value={whatsapp}
            placeholder="10 dígitos"
            class="mt-2"
          />
          {@render msg("whatsapp")}
          <p class="mt-2 text-sm text-piedra">Tus clientes enviarán su pedido a este número.</p>
        </div>
        <div class="mt-8 border-t border-linea pt-7">
          <h2 class="text-xl font-semibold tracking-[-0.02em]">Crea tu cuenta para publicar</h2>
          <p class="mt-1 text-sm text-piedra">
            Podrás ajustar precios, horarios y productos en cualquier momento.
          </p>
          <div class="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <Label for="correo" class="font-semibold">Correo electrónico</Label><Input
                id="correo"
                name="correo"
                bind:value={correo}
                aria-invalid={errores.correo ? "true" : undefined}
                aria-describedby={errores.correo ? "error-correo" : undefined}
                type="email"
                autocomplete="email"
                placeholder="tu@negocio.com"
                class="mt-2 text-sm"
              />
              {@render msg("correo")}
            </div>
            <div>
              <Label for="contrasena" class="font-semibold">Contraseña</Label><Input
                id="contrasena"
                name="contrasena"
                aria-invalid={errores.contrasena ? "true" : undefined}
                aria-describedby={errores.contrasena ? "error-contrasena" : undefined}
                type="password"
                autocomplete="new-password"
                placeholder="Mínimo 8 caracteres"
                class="mt-2 text-sm"
              />
              {@render msg("contrasena")}
            </div>
          </div>
          <Button type="submit" disabled={enviando} class="mt-6 w-full"
            >{enviando ? "Publicando…" : "Publicar menú"}</Button
          >
          <p class="mt-2 text-sm text-piedra">
            Es una demo: no se crea una cuenta real. Tu borrador se guarda en este navegador.
          </p>
        </div>
      </form>
    </section>
    <aside class="sticky top-8 hidden justify-self-end lg:block" aria-label="Vista previa del menú">
      {@render vistaPrevia()}
    </aside>
  </div>
</main>
