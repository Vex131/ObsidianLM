<script lang="ts">
  import PageHeader from "../layout/PageHeader.svelte";
  import SectionPanel from "../components/SectionPanel.svelte";
  import DetailRow from "../components/DetailRow.svelte";
  import CommandPreview from "../components/CommandPreview.svelte";
  import LogViewer from "../components/LogViewer.svelte";
  import ValidationChecklist from "../components/ValidationChecklist.svelte";
  import ToolbarButton from "../components/ToolbarButton.svelte";
  let { data, actions }: { data: any; actions: any } = $props();
</script>

<PageHeader eyebrow="MANAGED SERVER" title="Control llama.cpp runtime" subtitle="Manage and operate your local llama.cpp server with precision." />

<section class="runtime-hero panel-live">
  <div class="runtime-hero-state">
    <div class={`runtime-orb runtime-${data.runtimeStatus}`} aria-hidden="true"></div>
    <div>
      <p class="eyebrow">Managed runtime</p>
      <h2>{data.runtimeStatus}</h2>
      <p>{data.status?.activeRuntime ? "This process was started by the current ObsidianLM service session." : "Start a validated profile to launch llama-server.exe."}</p>
    </div>
  </div>
  <div class="runtime-hero-metrics">
    <DetailRow label="Active profile" value={data.status?.activeRuntime?.profileName ?? data.selectedProfile?.name ?? "None"} muted={!data.status?.activeRuntime && !data.selectedProfile} />
    <DetailRow label="Endpoint" value={data.apiUrl} />
    <DetailRow label="Port" value={data.portStatus?.port?.port ?? data.selectedProfile?.port ?? data.status?.managedLlamaPort} />
    <DetailRow label="PID" value={data.status?.activeRuntime?.pid} muted={!data.status?.activeRuntime?.pid} />
  </div>
</section>

<section class="runtime-action-bar" aria-label="Runtime actions">
  <ToolbarButton variant="success" onclick={actions.startSelectedProfile} disabled={!data.selectedProfileId || Boolean(data.pendingAction) || data.runtimeStatus === "running" || data.runtimeStatus === "starting" || data.selectedProfilePortConflict}>{data.pendingAction === "start" ? "Starting..." : "Start runtime"}</ToolbarButton>
  <ToolbarButton variant="danger" onclick={actions.stopRuntime} disabled={Boolean(data.pendingAction) || data.runtimeStatus === "stopped"}>{data.pendingAction === "stop" ? "Stopping..." : "Stop runtime"}</ToolbarButton>
  <ToolbarButton variant="secondary" onclick={actions.restartRuntime} disabled={Boolean(data.pendingAction) || data.runtimeStatus !== "running"}>{data.pendingAction === "restart" ? "Restarting..." : "Restart"}</ToolbarButton>
  <ToolbarButton variant="secondary" onclick={actions.validateSelectedProfile} disabled={!data.selectedProfileId || Boolean(data.pendingAction)}>{data.pendingAction === "validate" ? "Validating..." : "Validate"}</ToolbarButton>
  <ToolbarButton variant="ghost" onclick={() => navigator.clipboard.writeText(data.apiUrl)} disabled={!data.apiUrl}>Copy endpoint</ToolbarButton>
</section>
<p class="safety-copy">Stop and restart only affect the active child process started by this ObsidianLM service instance. External llama.cpp-like processes are read-only diagnostics.</p>
{#if data.selectedProfilePortMessage}<p class="port-conflict-copy">{data.selectedProfilePortMessage}</p>{/if}

<section class="runtime-grid">
  <SectionPanel tone={data.validation && !data.validation.valid ? "danger" : data.validation?.valid ? "live" : "default"} eyebrow="Validation" title="Startup checklist">
    <ValidationChecklist validation={data.validation} warnings={data.warnings} />
  </SectionPanel>
  <SectionPanel tone="code" eyebrow="Command preview" title="Launch command">
    <CommandPreview label={data.command?.executable ?? "llama-server.exe"} lines={data.commandLines} onCopy={actions.copyCommand} />
  </SectionPanel>
  <SectionPanel tone={data.detectionWarnings.length ? "warning" : "default"} eyebrow="Startup & safety" title="Detection policy">
    {#if data.detectionWarnings.length}<ul class="warning-list">{#each data.detectionWarnings as warning}<li>{warning}</li>{/each}</ul>{:else}<p class="empty-copy">ObsidianLM never kills unknown llama-server.exe processes and does not auto-start llama.cpp on service startup.</p>{/if}
    <div class="classification-strip">{#each data.detection?.categories ?? ["no_runtime_detected"] as category}<span>{category}</span>{/each}</div>
  </SectionPanel>
  <SectionPanel tone="code" eyebrow="Runtime logs" title="Startup and server output" class="span-2">
    <LogViewer entries={data.filteredLogs} onRefresh={actions.loadLogs} onCopy={actions.copyLogs} onClear={actions.clearVisibleLogs} />
  </SectionPanel>
</section>
