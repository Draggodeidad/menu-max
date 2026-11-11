<script lang="ts">
  import { page } from "$app/state";
  import Phone from "#lib/components/Phone.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import { onMount } from "svelte";

  type Producto = { id: number; nombre: string; precio: string };
  const ejemplo: Producto[] = [
    { id: 1, nombre: "Pastor con piña", precio: "22.00" },
    { id: 2, nombre: "Suadero confitado", precio: "24.00" },
    { id: 3, nombre: "Agua de horchata (1L)", precio: "35.00" },
  ];
  let nombre = $state(page.url.searchParams.get("nombre") ?? "");
  let productos = $state<Producto[]>(ejemplo.map((producto) => ({ ...producto })));
  let modalidades = $state<string[]>(["recoger"]);
  let whatsapp = $state("");
  let siguienteId = 4;
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
  const moneda = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

  // Se restaura una sola vez al montar. Con $effect el efecto leía y escribía
  // `productos` a la vez, y con un borrador guardado entraba en un bucle infinito.
  onMount(() => {
    try {
      const guardado = localStorage.getItem("menusmax-borrador");
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
</script>

<svelte:head>
  <title>Crea tu menú · MenusMax</title>
  <meta name="description" content="Arma el menú digital de tu negocio en MenusMax." />
</svelte:head>

{#snippet vistaPrevia()}
  <div class="flex flex-col items-center">
    <Phone>
      <div class="px-4">
        <h2 class="truncate pt-1 text-2xl font-bold tracking-[-0.03em]">
          {nombre.trim() || "Tu negocio"}
        </h2>
        <p class="mt-1 text-sm text-piedra">Vista previa de tu menú</p>
      </div>
      <div class="mt-3 border-y border-linea px-4 py-2">
        <span
          class="inline-block rounded-full border border-linea bg-cal px-3 py-1 text-xs font-medium"
          >Menú principal</span
        >
      </div>
      <div class="px-4">
        <h3 class="pt-4 pb-2 text-base font-semibold">Menú principal</h3>
        <ul class="border-t border-linea">
          {#each productos.filter((producto) => producto.nombre.trim()) as producto (producto.id)}
            <li class="flex items-center justify-between gap-3 border-b border-linea py-3">
              <div class="min-w-0">
                <p class="break-words text-sm font-semibold">{producto.nombre}</p>
                <p class="mt-1 text-xs font-semibold tabular-nums">
                  {moneda.format(Number(producto.precio) || 0)}
                </p>
              </div>
              <span
                class="grid size-8 shrink-0 place-items-center rounded-full bg-tinta text-white"
                aria-hidden="true"
              >
                <Plus class="size-4" />
              </span>
            </li>
          {/each}
        </ul>
      </div>
    </Phone>
    <p class="mt-4 max-w-[30ch] text-center text-sm text-piedra">
      Así se verá tu menú para tus clientes.
    </p>
  </div>
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
      <form class="mt-8" onsubmit={(event) => event.preventDefault()}>
        <div>
          <Label for="nombre" class="font-semibold">Nombre de tu negocio</Label>
          <Input
            id="nombre"
            name="nombre"
            autocomplete="organization"
            bind:value={nombre}
            placeholder="Nombre de tu negocio"
            class="mt-2"
          />
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
                  bind:value={producto.nombre}
                  placeholder="Nombre del producto"
                  class="min-w-0 flex-1 px-3 text-sm"
                />
                <Label class="sr-only" for="precio-{producto.id}">Precio del producto {i + 1}</Label
                >
                <Input
                  id="precio-{producto.id}"
                  bind:value={producto.precio}
                  type="number"
                  min="0"
                  step="0.01"
                  inputmode="decimal"
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
            {/each}
          </div>
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
        </fieldset>
        <div class="mt-10">
          <Label for="whatsapp" class="font-semibold">WhatsApp para recibir pedidos</Label>
          <Input
            id="whatsapp"
            type="tel"
            autocomplete="tel"
            bind:value={whatsapp}
            placeholder="10 dígitos"
            class="mt-2"
          />
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
                type="email"
                autocomplete="email"
                placeholder="tu@negocio.com"
                class="mt-2 text-sm"
              />
            </div>
            <div>
              <Label for="contrasena" class="font-semibold">Contraseña</Label><Input
                id="contrasena"
                type="password"
                autocomplete="new-password"
                placeholder="Mínimo 8 caracteres"
                class="mt-2 text-sm"
              />
            </div>
          </div>
          <Button type="submit" disabled class="mt-6 w-full">Publicar menú</Button>
          <p class="mt-2 text-sm text-piedra">
            La publicación aún no está disponible. Tu borrador se guarda en este navegador.
          </p>
        </div>
      </form>
    </section>
    <aside class="sticky top-8 hidden justify-self-end lg:block" aria-label="Vista previa del menú">
      {@render vistaPrevia()}
    </aside>
  </div>
</main>
