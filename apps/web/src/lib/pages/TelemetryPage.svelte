<script lang="ts">
  import PageHeader from "../layout/PageHeader.svelte";
  import SectionPanel from "../components/SectionPanel.svelte";
  import DetailRow from "../components/DetailRow.svelte";
  import ToolbarButton from "../components/ToolbarButton.svelte";
  let { data, actions }: { data: any; actions: any } = $props();
</script>

<PageHeader eyebrow="OBSERVABILITY" title="GPU, processes, and ports" subtitle="Read-only telemetry for local machine state and possible llama.cpp processes." />
<section class="runtime-grid">
  <SectionPanel tone={data.gpuTone} eyebrow="GPU devices" title="NVIDIA GPU status">
    <div class="panel-actions"><ToolbarButton variant="ghost" onclick={actions.refreshGpuStatus} disabled={Boolean(data.pendingAction)}>{data.pendingAction === "refresh-gpu" ? "Refreshing..." : "Refresh GPU"}</ToolbarButton></div>
    <DetailRow label="GPUs" value={data.gpuStatus?.summary?.gpuCount ?? data.status?.gpu?.gpuCount ?? 0} />
    <DetailRow label="VRAM used" value={`${data.formatMiB(data.gpuStatus?.summary?.usedMemoryMiB ?? data.status?.gpu?.usedMemoryMiB)} / ${data.formatMiB(data.gpuStatus?.summary?.totalMemoryMiB ?? data.status?.gpu?.totalMemoryMiB)}`} />
    <DetailRow label="Managed runtime VRAM" value={data.formatMiB(data.gpuStatus?.summary?.currentManagedRuntimeGpuMemoryMiB ?? data.status?.gpu?.currentManagedRuntimeGpuMemoryMiB)} />
  </SectionPanel>
  <SectionPanel tone={data.detectedProcesses.length ? "warning" : "default"} eyebrow="Processes" title="Detected llama.cpp-like processes">
    {#each data.detectedProcesses as process}<article class="process-card"><strong>PID {process.pid}</strong><p>{process.name}</p>{#if process.executablePath}<code>{process.executablePath}</code>{/if}<small>{process.reasons.join(" ")}</small></article>{:else}<p class="empty-copy">No llama-server-like processes were detected.</p>{/each}
  </SectionPanel>
  <SectionPanel tone={data.portStatus?.conflict ? "danger" : data.portStatus?.port?.inUse ? "warning" : "default"} eyebrow="Port status" title={`Port ${data.portStatus?.port?.port ?? data.selectedProfile?.port ?? data.status?.managedLlamaPort ?? 8085}`}>
    <DetailRow label="Status" value={data.portStatus?.port?.inUse ? "In use" : "Free"} />
    <DetailRow label="Owner PID" value={data.portStatus?.port?.ownerPid ?? "Unknown"} />
    <DetailRow label="Host checked" value={data.portStatus?.port?.host ?? "127.0.0.1"} />
  </SectionPanel>
</section>
