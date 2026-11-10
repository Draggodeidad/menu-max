<script lang="ts">
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<div
  class="relative h-[620px] w-[300px] shrink-0 overflow-hidden rounded-[44px] border-[10px] border-tinta bg-white shadow-[0_30px_60px_-20px_rgb(28_31_26/0.35)]"
>
  <div
    class="flex h-10 items-center justify-between px-5 pt-1 text-[11px] font-semibold tabular-nums"
    aria-hidden="true"
  >
    <span>9:41</span>
    <span class="absolute left-1/2 top-2 h-[22px] w-[74px] -translate-x-1/2 rounded-full bg-tinta"
    ></span>
    <span class="h-2.5 w-4 rounded-[3px] border border-tinta"></span>
  </div>

  <div class="h-[calc(100%-2.5rem)] overflow-hidden">
    {@render children()}
  </div>

  <span
    class="absolute bottom-2 left-1/2 h-1 w-28 -translate-x-1/2 rounded-full bg-linea"
    aria-hidden="true"
  ></span>
</div>
