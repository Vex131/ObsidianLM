<script lang="ts">
  import type { Snippet } from "svelte";

  type PanelTone = "default" | "live" | "warning" | "danger" | "code";

  let {
    eyebrow,
    title,
    tone = "default",
    class: className = "",
    children
  }: {
    eyebrow?: string;
    title?: string;
    tone?: PanelTone;
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<section class={`panel panel-${tone} ${className}`.trim()}>
  {#if eyebrow || title}
    <header class="panel-header">
      {#if eyebrow}
        <p class="eyebrow">{eyebrow}</p>
      {/if}
      {#if title}
        <h2>{title}</h2>
      {/if}
    </header>
  {/if}

  {@render children?.()}
</section>
