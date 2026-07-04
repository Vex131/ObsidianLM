<script lang="ts">
  import type { Snippet } from "svelte";

  let { title, eyebrow, children }: { title: string; eyebrow?: string; children?: Snippet } = $props();
</script>

<section class="inspector-panel">
  <header>
    {#if eyebrow}<p class="eyebrow">{eyebrow}</p>{/if}
    <h2>{title}</h2>
  </header>
  <div class="inspector-stack">
    {@render children?.()}
  </div>
</section>
