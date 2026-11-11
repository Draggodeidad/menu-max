<script lang="ts">
  const secciones = [3, 2];
</script>

<main class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-8" aria-busy="true">
  <p class="sr-only" role="status">Cargando tu menú…</p>
  <div class="animate-pulse motion-reduce:animate-none" aria-hidden="true">
    <div class="h-9 w-32 rounded-lg bg-linea"></div>
    <div class="mt-3 h-5 w-full max-w-md rounded-lg bg-linea"></div>
    <div class="mt-6 h-16 rounded-xl bg-linea/60"></div>
    {#each secciones as filas, i (i)}
      <div class="mt-10 h-7 w-36 rounded-lg bg-linea"></div>
      <div class="mt-4 divide-y divide-linea rounded-xl border border-linea bg-white">
        {#each { length: filas } as _, j (j)}
          <div class="flex items-center gap-4 px-4 py-4">
            <div class="size-16 shrink-0 rounded-xl bg-linea"></div>
            <div class="grid flex-1 gap-2">
              <div class="h-5 w-48 max-w-full rounded-lg bg-linea"></div>
              <div class="h-4 w-full max-w-md rounded-lg bg-linea/60"></div>
            </div>
          </div>
        {/each}
      </div>
    {/each}
  </div>
</main>
