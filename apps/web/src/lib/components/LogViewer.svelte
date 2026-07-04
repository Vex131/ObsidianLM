<script lang="ts">
  import ToolbarButton from "./ToolbarButton.svelte";

  let {
    entries = [],
    empty = "No logs available.",
    onRefresh,
    onCopy,
    onClear
  }: {
    entries: Array<{ timestamp: string; source: string; message: string; sequence?: number }>;
    empty?: string;
    onRefresh?: () => Promise<void> | void;
    onCopy?: () => Promise<void> | void;
    onClear?: () => Promise<void> | void;
  } = $props();
</script>

<div class="logs-block">
  <div class="logs-toolbar compact">
    <span>{entries.length} visible entries</span>
    <div class="panel-actions inline-actions logs-actions">
      {#if onRefresh}<ToolbarButton variant="ghost" onclick={onRefresh}>Refresh</ToolbarButton>{/if}
      {#if onCopy}<ToolbarButton variant="ghost" onclick={onCopy} disabled={!entries.length}>Copy visible</ToolbarButton>{/if}
      {#if onClear}<ToolbarButton variant="ghost" onclick={onClear} disabled={!entries.length}>Clear view</ToolbarButton>{/if}
    </div>
  </div>
  <div class="log-viewer operator-log-viewer" aria-label="Runtime logs">
    {#if entries.length}
      {#each entries as entry (`${entry.timestamp}-${entry.sequence ?? entry.message}`)}
        <div class={`log-entry log-source-${entry.source}`}>
          <span class="log-time">{entry.timestamp}</span>
          <span class="log-source">{entry.source}</span>
          <span class="log-message">{entry.message}</span>
        </div>
      {/each}
    {:else}
      <p class="empty-copy">{empty}</p>
    {/if}
  </div>
</div>
