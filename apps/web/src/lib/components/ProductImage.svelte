<script lang="ts">
  import { cn } from "#lib/utils.js";

  let { src, alt, class: className }: { src: string; alt: string; class?: string } = $props();
</script>

<img
  {src}
  {alt}
  width="64"
  height="64"
  loading="lazy"
  decoding="async"
  class={cn("size-16 rounded-xl bg-(color:--brand-tint) object-cover", className)}
/>
