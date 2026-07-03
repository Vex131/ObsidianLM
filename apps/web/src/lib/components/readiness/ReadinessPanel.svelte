<script lang="ts">
  import type { ReadinessCheck, ReadinessCheckStatus, ReadinessResponse } from "@obsidianlm/shared";
  import MetricRow from "../MetricRow.svelte";
  import Panel from "../Panel.svelte";
  import StatusPill from "../StatusPill.svelte";

  let { readiness }: { readiness: ReadinessResponse | null } = $props();

  function pillTone(status: ReadinessCheckStatus): "online" | "offline" | "warning" | "danger" | "unknown" {
    if (status === "pass") {
      return "online";
    }
    if (status === "block") {
      return "danger";
    }
    if (status === "warning") {
      return "warning";
    }
    return "unknown";
  }

  function statusLabel(status: ReadinessCheckStatus): string {
    return status === "pass" ? "Ready" : status === "block" ? "Blocked" : status === "warning" ? "Warning" : "Unavailable";
  }

  const panelTone = $derived(!readiness ? "default" : readiness.blockingChecks.length ? "danger" : readiness.warnings.length || readiness.nextActions.length ? "warning" : "live");
  const primaryChecks = $derived(readiness?.checks.filter((item: ReadinessCheck) => item.status !== "pass") ?? []);
</script>

<Panel tone={panelTone} eyebrow="Readiness" title="Setup checklist" class="readiness-card">
  {#if !readiness}
    <p class="empty-copy">Readiness has not loaded yet. The checklist is available after admin setup and login.</p>
  {:else}
    <div class="runtime-summary">
      <div class={`runtime-orb ${readiness.ok ? "runtime-running" : "runtime-failed"}`} aria-hidden="true"></div>
      <div>
        <StatusPill tone={readiness.ok ? "online" : "danger"} label={readiness.ok ? "Ready for local validation" : "Setup incomplete"} />
        <p>{readiness.ok ? "Core requirements are satisfied. Run the real-use checklist before relying on a local runtime." : "Finish the blocking checks before real local validation."}</p>
      </div>
    </div>

    <div class="metric-grid compact">
      <MetricRow label="GGUF models" value={`${readiness.counts.ggufModels}`} muted={readiness.counts.ggufModels === 0} />
      <MetricRow label="Server builds" value={`${readiness.counts.serverBuilds}`} muted={readiness.counts.serverBuilds === 0} />
      <MetricRow label="llama-bench" value={`${readiness.counts.llamaBenchTools}`} muted={readiness.counts.llamaBenchTools === 0} />
      <MetricRow label="llama-perplexity" value={`${readiness.counts.llamaPerplexityTools}`} muted={readiness.counts.llamaPerplexityTools === 0} />
      <MetricRow label="Tool inputs" value={`${readiness.counts.toolInputs}`} muted={readiness.counts.toolInputs === 0} />
      <MetricRow label="Profiles" value={`${readiness.counts.profiles}`} muted={readiness.counts.profiles === 0} />
    </div>

    {#if readiness.counts.ggufModels === 0 || readiness.counts.serverBuilds === 0 || readiness.counts.toolInputs === 0}
      <p class="empty-copy">Empty discoveries are expected on a fresh install. Configure model, llama.cpp, and tool input folders, then rescan before real-use validation.</p>
    {/if}

    <div class="metric-grid compact">
      <MetricRow label="Managed port" value={readiness.managedPort.conflict ? "Conflict" : readiness.managedPort.inUse ? "In use" : "Free"} />
      <MetricRow label="GPU monitor" value={readiness.gpu.available ? `${readiness.gpu.gpuCount} GPU(s)` : "Unavailable"} muted={!readiness.gpu.available} />
      <MetricRow label="Runtime" value={readiness.runtime.active ? readiness.runtime.status : "No active runtime"} muted={!readiness.runtime.active} />
      <MetricRow label="Storage warnings" value={`${readiness.storageWarnings.length}`} muted={readiness.storageWarnings.length === 0} />
    </div>

    {#if primaryChecks.length}
      <h3>Needs attention</h3>
      <ul class="warning-list">
        {#each primaryChecks as item}
          <li><StatusPill tone={pillTone(item.status)} label={statusLabel(item.status)} /> {item.label}: {item.message}</li>
        {/each}
      </ul>
    {:else}
      <p class="empty-copy">No blocking readiness checks are currently reported.</p>
    {/if}

    {#if readiness.nextActions.length}
      <h3>Next recommended actions</h3>
      <ol class="warning-list">
        {#each readiness.nextActions as action}
          <li>{action}</li>
        {/each}
      </ol>
    {/if}
  {/if}
</Panel>
