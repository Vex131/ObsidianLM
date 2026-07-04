<script lang="ts">
  import PageHeader from "../layout/PageHeader.svelte";
  import SectionPanel from "../components/SectionPanel.svelte";
  import DetailRow from "../components/DetailRow.svelte";
  import StatusBadge from "../components/StatusBadge.svelte";
  import CommandPreview from "../components/CommandPreview.svelte";
  import LogViewer from "../components/LogViewer.svelte";
  import ValidationChecklist from "../components/ValidationChecklist.svelte";
  import ToolbarButton from "../components/ToolbarButton.svelte";

  let { data, actions }: { data: any; actions: any } = $props();
</script>

<PageHeader eyebrow="COMMAND CENTER" title="ObsidianLM operator console" subtitle="Control and monitor your local llama.cpp runtimes with precision." />

<section class="runtime-hero panel-live">
  <div class="runtime-hero-state">
    <div class={`runtime-orb runtime-${data.runtimeStatus}`} aria-hidden="true"></div>
    <div>
      <p class="eyebrow">Runtime status</p>
      <h2>{data.runtimeStatus}</h2>
      <p>{data.status?.activeRuntime ? "Managed llama.cpp server is active in this service session." : "No managed llama.cpp server is running."}</p>
    </div>
  </div>
  <div class="runtime-hero-metrics">
    <DetailRow label="Profile" value={data.status?.activeRuntime?.profileName ?? data.selectedProfile?.name ?? "None"} muted={!data.status?.activeRuntime && !data.selectedProfile} />
    <DetailRow label="Endpoint" value={data.apiUrl} />
    <DetailRow label="PID" value={data.status?.activeRuntime?.pid} muted={!data.status?.activeRuntime?.pid} />
    <DetailRow label="Command hash" value={data.runtime?.commandHash ?? data.command?.commandHash} muted={!data.runtime?.commandHash && !data.command?.commandHash} />
  </div>
</section>

<section class="quick-actions-strip" aria-label="Quick actions">
  <ToolbarButton variant="success" onclick={actions.startSelectedProfile} disabled={!data.selectedProfileId || Boolean(data.pendingAction) || data.runtimeStatus === "running" || data.runtimeStatus === "starting" || data.selectedProfilePortConflict}>{data.pendingAction === "start" ? "Starting..." : "Start runtime"}</ToolbarButton>
  <ToolbarButton variant="secondary" onclick={actions.validateSelectedProfile} disabled={!data.selectedProfileId || Boolean(data.pendingAction)}>{data.pendingAction === "validate" ? "Validating..." : "Validate"}</ToolbarButton>
  <ToolbarButton variant="secondary" onclick={() => { location.hash = "#runtime"; }}>Open runtime controls</ToolbarButton>
  <ToolbarButton variant="ghost" onclick={actions.copyCommand} disabled={!data.command}>Copy command</ToolbarButton>
</section>

<section class="dashboard-workgrid">
  <SectionPanel eyebrow="Active profile" title="Launch target">
    <DetailRow label="Name" value={data.selectedProfile?.name ?? "No profile selected"} muted={!data.selectedProfile} />
    <DetailRow label="Model" value={data.selectedProfile?.modelPath} muted={!data.selectedProfile?.modelPath} />
    <DetailRow label="Build" value={data.selectedProfile?.buildPath} muted={!data.selectedProfile?.buildPath} />
  </SectionPanel>

  <SectionPanel tone={data.warnings.length || data.detectionWarnings.length ? "warning" : "default"} eyebrow="Safety" title="Warnings">
    <ValidationChecklist validation={data.validation} warnings={[...data.warnings, ...data.detectionWarnings]} />
  </SectionPanel>

  <SectionPanel tone="code" eyebrow="Command preview" title="Current launch command" class="span-2">
    <CommandPreview label={data.command?.executable ?? "llama-server.exe"} lines={data.commandLines} onCopy={actions.copyCommand} />
  </SectionPanel>

  <SectionPanel tone="code" eyebrow="Recent logs" title="Recent Runtime Logs" class="span-2">
    <LogViewer entries={data.filteredLogs.slice(-80)} onRefresh={actions.loadLogs} onCopy={actions.copyLogs} onClear={actions.clearVisibleLogs} />
  </SectionPanel>

  <SectionPanel eyebrow="GPU / telemetry" title="Local machine summary">
    <StatusBadge tone={data.gpuTone} label={data.gpuStatus?.available === false ? "GPU unavailable" : "Telemetry read-only"} />
    <DetailRow label="GPUs" value={data.gpuStatus?.summary?.gpuCount ?? data.status?.gpu?.gpuCount ?? 0} />
    <DetailRow label="VRAM used" value={`${data.formatMiB(data.gpuStatus?.summary?.usedMemoryMiB ?? data.status?.gpu?.usedMemoryMiB)} / ${data.formatMiB(data.gpuStatus?.summary?.totalMemoryMiB ?? data.status?.gpu?.totalMemoryMiB)}`} />
    <DetailRow label="Unknown GPU processes" value={data.gpuStatus?.summary?.unknownGpuProcessCount ?? data.status?.gpu?.unknownGpuProcessCount ?? 0} />
  </SectionPanel>
</section>
