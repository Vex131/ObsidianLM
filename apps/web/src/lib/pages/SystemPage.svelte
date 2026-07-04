<script lang="ts">
  import PageHeader from "../layout/PageHeader.svelte";
  import SectionPanel from "../components/SectionPanel.svelte";
  import DetailRow from "../components/DetailRow.svelte";
  import RuntimeDiagnosticsPanel from "../components/runtime/RuntimeDiagnosticsPanel.svelte";
  import ReadinessPanel from "../components/readiness/ReadinessPanel.svelte";
  let { data, actions }: { data: any; actions: any } = $props();
</script>

<PageHeader eyebrow="SYSTEM" title="Service diagnostics" subtitle="Inspect service mode, readiness, and runtime health without changing llama.cpp state." />
<section class="runtime-grid">
  <SectionPanel eyebrow="Service mode" title="Local service facts">
    <DetailRow label="Running mode" value={data.runningModeLabel} />
    <DetailRow label="Service mode" value={data.status?.serviceMode ? "Enabled" : "Disabled"} />
    <DetailRow label="Data directory" value={data.dataDirModeLabel} />
    <DetailRow label="Log directory" value={data.logDirModeLabel} />
  </SectionPanel>
  <RuntimeDiagnosticsPanel health={data.runtimeHealth} testChatResult={data.testChatResult} pendingAction={data.pendingAction} onCheckHealth={actions.checkRuntimeHealth} onRunTestChat={actions.runRuntimeTestChat} />
  <ReadinessPanel readiness={data.readiness} />
</section>
