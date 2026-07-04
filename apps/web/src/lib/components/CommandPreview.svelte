<script lang="ts">
  import ToolbarButton from "./ToolbarButton.svelte";

  let { label = "command", lines = [], onCopy }: { label?: string; lines: string[]; onCopy?: () => Promise<void> | void } = $props();
</script>

<div class="command-preview">
  <div class="code-surface-header">
    <span>{label}</span>
    {#if onCopy}<ToolbarButton variant="ghost" onclick={onCopy} disabled={!lines.length}>Copy</ToolbarButton>{/if}
  </div>
  <pre>{lines.join("\n")}</pre>
</div>
