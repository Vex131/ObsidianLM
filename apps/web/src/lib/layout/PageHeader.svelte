<script lang="ts">
  import type { Snippet } from "svelte";

  let { eyebrow, title, subtitle, actions }: { eyebrow: string; title: string; subtitle: string; actions?: Snippet } = $props();
</script>

<header class="page-header">
  <div>
    <p class="eyebrow">{eyebrow}</p>
    <h1>{title}</h1>
    <p>{subtitle}</p>
  </div>
  {#if actions}
    <div class="page-header-actions">
      {@render actions()}
    </div>
  {/if}
</header>
