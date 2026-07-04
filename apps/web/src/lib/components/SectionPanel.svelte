<script lang="ts">
  import type { Snippet } from "svelte";

  let { eyebrow, title, tone = "default", class: className = "", children }: { eyebrow?: string; title?: string; tone?: string; class?: string; children?: Snippet } = $props();
</script>

<section class={`section-panel panel-${tone} ${className}`.trim()}>
  {#if eyebrow || title}
    <header class="section-panel-header">
      {#if eyebrow}<p class="eyebrow">{eyebrow}</p>{/if}
      {#if title}<h2>{title}</h2>{/if}
    </header>
  {/if}
  {@render children?.()}
</section>
