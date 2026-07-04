<script lang="ts">
  import type { Snippet } from "svelte";
  let { title, description, tone = "default", onclick, disabled = false, children }: { title: string; description: string; tone?: string; onclick?: () => Promise<void> | void; disabled?: boolean; children?: Snippet } = $props();
</script>

<button class={`action-tile action-${tone}`} type="button" {onclick} {disabled}>
  <strong>{title}</strong>
  <span>{description}</span>
  {@render children?.()}
</button>
