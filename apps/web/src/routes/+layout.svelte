<script lang="ts">
  // oxlint-disable-next-line import/no-unassigned-import -- side-effect import: global stylesheet
  import "../app.css";

  let { children } = $props();
</script>

{@render children()}
