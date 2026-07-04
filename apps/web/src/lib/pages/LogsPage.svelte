<script lang="ts">
  import PageHeader from "../layout/PageHeader.svelte";
  import SectionPanel from "../components/SectionPanel.svelte";
  import LogViewer from "../components/LogViewer.svelte";
  import StatusBadge from "../components/StatusBadge.svelte";
  let { data, actions, logSearch = $bindable() }: any = $props();
</script>

<PageHeader eyebrow="LOG INSPECTION" title="Runtime and service logs" subtitle="Inspect full visible runtime output with filtering and copy controls." />
<SectionPanel tone="code" eyebrow="Logs" title="Full log viewer">
  <div class="logs-toolbar"><StatusBadge tone={data.logConnectionTone} label={`Live stream ${data.logStreamState}`} /><span>{data.logStatusText}</span></div>
  <label class="field-label" for="runtime-log-search">Search visible logs</label>
  <input id="runtime-log-search" class="log-search-input" bind:value={logSearch} placeholder="Filter by message, source, or timestamp" />
  <LogViewer entries={data.filteredLogs} onRefresh={actions.loadLogs} onCopy={actions.copyLogs} onClear={actions.clearVisibleLogs} />
</SectionPanel>
