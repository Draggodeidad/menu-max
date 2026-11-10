<script lang="ts">
  import { page } from "$app/state";
  import Phone from "#lib/components/Phone.svelte";

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

  $effect(() => {
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
                class="grid size-8 shrink-0 place-items-center rounded-full bg-piedra/60 text-white"
                aria-hidden="true">+</span
              >
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
    <a
      href="/entrar"
      class="inline-flex h-11 items-center rounded-lg border border-linea bg-white px-5 text-sm font-medium hover:bg-cal"
      >Entrar</a
    >
  </div>
</header>

<main class="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
  <details open class="mb-8 lg:hidden">
    <summary class="cursor-pointer rounded-lg border border-linea bg-white px-4 py-3 font-semibold"
      >Vista previa de tu menú</summary
    >
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
          <label for="nombre" class="text-sm font-semibold">Nombre de tu negocio</label>
          <input
            id="nombre"
            name="nombre"
            autocomplete="organization"
            bind:value={nombre}
            placeholder="Nombre de tu negocio"
            class="mt-2 h-12 w-full rounded-lg border border-linea bg-white px-4 outline-none placeholder:text-piedra focus:border-nopal focus:ring-2 focus:ring-nopal/20"
          />
        </div>
        <div class="mt-5">
          <p class="text-sm font-semibold">Enlace de tu menú</p>
          <p class="mt-2 break-all rounded-lg border border-linea px-4 py-3 text-sm text-piedra">
            menusmax.mx/m/<span class="text-tinta">{slug || "tu-negocio"}</span>
          </p>
        </div>
        <fieldset class="mt-10">
          <div class="flex items-baseline justify-between gap-3">
            <legend class="font-semibold">Productos y precios</legend><span
              class="text-sm text-piedra">Pesos MXN</span
            >
          </div>
          <div class="mt-3 space-y-2">
            {#each productos as producto, i (producto.id)}
              <div class="flex gap-2">
                <label class="sr-only" for="producto-{producto.id}"
                  >Nombre del producto {i + 1}</label
                >
                <input
                  id="producto-{producto.id}"
                  bind:value={producto.nombre}
                  placeholder="Nombre del producto"
                  class="h-12 min-w-0 flex-1 rounded-lg border border-linea px-3 text-sm outline-none placeholder:text-piedra focus:border-nopal focus:ring-2 focus:ring-nopal/20"
                />
                <label class="sr-only" for="precio-{producto.id}">Precio del producto {i + 1}</label
                >
                <input
                  id="precio-{producto.id}"
                  bind:value={producto.precio}
                  type="number"
                  min="0"
                  step="0.01"
                  inputmode="decimal"
                  placeholder="$ 0.00"
                  class="h-12 w-24 rounded-lg border border-linea px-3 text-sm tabular-nums outline-none placeholder:text-piedra focus:border-nopal focus:ring-2 focus:ring-nopal/20 sm:w-32"
                />
                <button
                  type="button"
                  aria-label="Quitar producto {i + 1}"
                  onclick={() => (productos = productos.filter((p) => p.id !== producto.id))}
                  class="grid size-12 shrink-0 place-items-center rounded-lg border border-linea text-piedra hover:bg-cal"
                  ><svg
                    viewBox="0 0 24 24"
                    class="size-5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" /></svg
                  ></button
                >
              </div>
            {/each}
          </div>
          <button
            type="button"
            onclick={() =>
              (productos = [...productos, { id: siguienteId++, nombre: "", precio: "" }])}
            class="mt-3 h-11 rounded-lg border border-linea px-4 text-sm font-medium hover:bg-cal"
            >+ Agregar producto</button
          >
        </fieldset>
        <fieldset class="mt-10">
          <legend class="text-sm font-semibold">Cómo entregas tus pedidos</legend>
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
          <label for="whatsapp" class="text-sm font-semibold">WhatsApp para recibir pedidos</label>
          <input
            id="whatsapp"
            type="tel"
            autocomplete="tel"
            bind:value={whatsapp}
            placeholder="10 dígitos"
            class="mt-2 h-12 w-full rounded-lg border border-linea px-4 outline-none placeholder:text-piedra focus:border-nopal focus:ring-2 focus:ring-nopal/20"
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
              <label for="correo" class="text-sm font-semibold">Correo electrónico</label><input
                id="correo"
                type="email"
                autocomplete="email"
                placeholder="tu@negocio.com"
                class="mt-1 h-12 w-full rounded-lg border border-linea px-4 text-sm outline-none placeholder:text-piedra focus:border-nopal focus:ring-2 focus:ring-nopal/20"
              />
            </div>
            <div>
              <label for="contrasena" class="text-sm font-semibold">Contraseña</label><input
                id="contrasena"
                type="password"
                autocomplete="new-password"
                placeholder="Mínimo 8 caracteres"
                class="mt-1 h-12 w-full rounded-lg border border-linea px-4 text-sm outline-none placeholder:text-piedra focus:border-nopal focus:ring-2 focus:ring-nopal/20"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled
            class="mt-4 h-12 w-full rounded-lg bg-nopal px-5 font-semibold text-white disabled:opacity-50"
            >Publicar menú</button
          >
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
