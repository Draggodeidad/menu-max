<script lang="ts">
  import { cn } from "#lib/utils.js";

  let { variant }: { variant: "menu" | "pedido" } = $props();

  const bar = "rounded-md bg-(color:--brand-tint) motion-safe:animate-pulse";
</script>

<!-- Misma geometría que MenuView / pedido. Aparece tras 200 ms para no parpadear en cargas rápidas. -->
<div
  aria-busy="true"
  aria-label="Cargando"
  role="status"
  class="skeleton-in noscript:hidden mx-auto min-h-dvh max-w-md bg-(color:--brand-bg) md:border-x md:border-(color:--brand-line)"
>
  {#if variant === "menu"}
    <div class="px-5 pt-6 pb-5">
      <div class={cn(bar, "mb-3 h-8 w-24 rounded-full")}></div>
      <div class={cn(bar, "h-9 w-3/4")}></div>
      <div class={cn(bar, "mt-2.5 h-5 w-1/2")}></div>
    </div>
    <div class="flex gap-2 border-y border-(color:--brand-line) px-5 py-3">
      {#each [20, 24, 20] as w, i (i)}
        <div class={cn(bar, "h-11 rounded-full")} style:width="{w * 4}px"></div>
      {/each}
    </div>
    <div class="px-5 pt-6">
      <div class={cn(bar, "mb-3 h-7 w-28")}></div>
      <div class="border-t border-(color:--brand-line)">
        {#each [true, true, false] as conImagen, i (i)}
          <div class="flex gap-4 border-b border-(color:--brand-line) py-5">
            <div class="flex-1 space-y-2">
              <div class={cn(bar, "h-5 w-2/3")}></div>
              <div class={cn(bar, "h-4 w-full")}></div>
              <div class={cn(bar, "h-4 w-4/5")}></div>
              <div class={cn(bar, "mt-3 h-5 w-16")}></div>
            </div>
            <div class="flex flex-col items-end justify-between gap-3">
              {#if conImagen}<div class={cn(bar, "size-16 rounded-xl")}></div>{/if}
              <div class={cn(bar, "mt-auto size-11 rounded-full")}></div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <div class="px-5 pt-6 pb-5">
      <div class={cn(bar, "h-9 w-1/2")}></div>
      <div class={cn(bar, "mt-2.5 h-5 w-2/3")}></div>
    </div>
    <div class="border-t border-(color:--brand-line) px-5">
      {#each [0, 1, 2] as i (i)}
        <div class="flex items-center gap-4 border-b border-(color:--brand-line) py-5">
          <div class="flex-1 space-y-2">
            <div class={cn(bar, "h-5 w-2/3")}></div>
            <div class={cn(bar, "h-4 w-16")}></div>
          </div>
          <div class={cn(bar, "h-11 w-32 rounded-lg")}></div>
        </div>
      {/each}
      <div class="flex justify-between py-5">
        <div class={cn(bar, "h-6 w-16")}></div>
        <div class={cn(bar, "h-6 w-20")}></div>
      </div>
    </div>
  {/if}
</div>

<style>
  .skeleton-in {
    opacity: 0;
    animation: skeleton-show 0s 200ms forwards;
  }
  @keyframes skeleton-show {
    to {
      opacity: 1;
    }
  }
</style>
