<script lang="ts">
  const secciones = [2, 2, 1];
</script>

<main class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-8" aria-busy="true">
  <p class="sr-only" role="status">Cargando pedidos…</p>
  <div class="animate-pulse motion-reduce:animate-none" aria-hidden="true">
    <div class="h-9 w-40 rounded-lg bg-linea"></div>
    <div class="mt-3 h-5 w-full max-w-sm rounded-lg bg-linea"></div>
    <div class="mt-8 h-16 rounded-xl bg-linea/60"></div>
    {#each secciones as tarjetas, i (i)}
      <div class="mt-10 h-7 w-36 rounded-lg bg-linea"></div>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        {#each { length: tarjetas } as _, j (j)}
          <div class="h-72 rounded-xl bg-linea/60"></div>
        {/each}
      </div>
    {/each}
  </div>
</main>
