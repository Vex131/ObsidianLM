<script lang="ts">
  import { onMount } from "svelte";
  import PageHeader from "../components/PageHeader.svelte";
  import Icon from "../components/Icon.svelte";
  import StatusDot from "../components/StatusDot.svelte";
  import type { RouterRuntimeResponse } from "@obsidianlm/shared";
  import { API_ENDPOINTS, fetchJson, type GpuMonitoringStatus, type RuntimeActionResult } from "../api";
  import { emptyDashboardData, fetchDashboardData, type DashboardData } from "../dashboard/dashboard-data";
  import { createCompletionAwarePoller, type CompletionAwarePoller } from "../polling";
  import {
    clampPercent,
    formatNumber,
    formatPowerWatts,
    formatTemperature,
    formatTimestamp,
    formatUptime,
    formatUtilization,
    formatVramMiB,
    inferLogTone,
    vramPercent
  } from "../dashboard/dashboard-format";
  import { visionCapabilityKind } from "../vision";
  export let routerRuntime: RouterRuntimeResponse | null = null;

  type HealthTone = "ok" | "warn" | "error" | "muted";
  type HealthItem = { label: string; state: string; tone: HealthTone };

  let dashboardData: DashboardData = emptyDashboardData;
  let copyLabel = "Copy";
  let actionPending = false;
  let actionError = "";
  let poller: CompletionAwarePoller | undefined;
  let refreshGeneration = 0;

  $: runtime = dashboardData.runtime ?? routerRuntime;
  $: router = runtime?.routerState ?? null;
  $: routerStatus = router?.status ?? "unknown";
  $: isRunning = routerStatus === "running";
  $: isTransitioning = routerStatus === "starting" || routerStatus === "stopping";
  $: activeBuild = dashboardData.builds.find((build) => build.id === router?.activeBuildId) ?? null;
  $: modelStates = router?.configuredModelStates ?? [];
  $: loadedStates = modelStates.filter((entry) => entry.state === "loaded");
  $: activeModelId = loadedStates.length === 1 ? loadedStates[0].configuredModelId : null;
  $: activeModel = dashboardData.configuredModels.find((model) => model.id === activeModelId) ?? null;
  $: activeModelLabel = activeModel?.displayName ?? activeModelId ?? null;
  $: endpoint = router?.port ? `http://localhost:${router.port}/v1` : `Managed port ${dashboardData.readiness?.managedPort.port ?? "—"} stopped`;
  $: heroTitle = routerStatus === "stopped" ? "Managed router stopped" : routerStatus === "failed" ? "Managed router failed" : routerStatus === "unknown" || routerStatus === "unknown_previous_runtime" ? "Managed router status uncertain" : activeBuild?.displayName ?? router?.activeBuildId ?? "Managed router";
  $: heroSubtitle = runtimeSubtitle();
  $: runtimeLabel = `Router ${routerStatus}`;
  $: pidLabel = router?.pid ? String(router.pid) : "—";
  $: uptimeLabel = formatUptime(router?.startedAt);
  $: llamaArgs = activeModel?.llamaArgs;
  $: healthItems = buildHealthItems();
  $: healthOkCount = healthItems.filter((item) => item.tone === "ok").length;
  $: gpuDevices = dashboardData.gpuStatus?.gpus ?? [];
  $: recentLogs = dashboardData.runtimeLogs.slice().reverse();
  $: runtimeTone = (routerStatus === "running" ? "green" : isTransitioning ? "amber" : routerStatus === "failed" ? "red" : "muted") as "green" | "amber" | "red" | "muted";

  async function refreshDashboardData() {
    const requestGeneration = ++refreshGeneration;
    const data = await fetchDashboardData();
    if (requestGeneration === refreshGeneration) {
      dashboardData = data;
    }
  }

  async function runRuntimeAction(action: "restart" | "stop") {
    if (actionPending) {
      return;
    }

    actionPending = true;
    actionError = "";
    try {
      const result = await fetchJson<RuntimeActionResult>(action === "restart" ? API_ENDPOINTS.runtime.restart : API_ENDPOINTS.runtime.stop, { method: "POST" });
      if (!result.ok) {
        actionError = result.error ?? result.message;
      }
      await (poller?.refresh() ?? refreshDashboardData());
    } catch (error) {
      actionError = error instanceof Error ? error.message : "Router action failed.";
      await (poller?.refresh() ?? refreshDashboardData());
    } finally {
      actionPending = false;
    }
  }

  async function copyEndpoint() {
    if (!endpoint || endpoint === "—") {
      copyLabel = "Unavailable";
    } else {
      try {
        await navigator.clipboard.writeText(endpoint);
        copyLabel = "Copied";
      } catch {
        copyLabel = "Copy failed";
      }
    }
    window.setTimeout(() => {
      copyLabel = "Copy";
    }, 1200);
  }

  function runtimeSubtitle(): string {
    const health = router?.health.state ?? "unknown";
    const loading = modelStates.find((entry) => entry.state === "loading");
    const loadingModel = dashboardData.configuredModels.find((model) => model.id === loading?.configuredModelId);
    if (routerStatus === "stopped") return "No managed router is currently running.";
    if (routerStatus === "unknown_previous_runtime") return "Previous router ownership is uncertain; ObsidianLM has not adopted or stopped it.";
    if (loadedStates.length > 1) return `${health} router health · ${loadedStates.length} models loaded · policy warning`;
    if (loading) return `Loading ${loadingModel?.displayName ?? loading.configuredModelId}`;
    if (activeModelLabel) return `${health} router health · ${activeModelLabel} loaded`;
    return `${health} router health · no model loaded`;
  }

  function buildHealthItems(): HealthItem[] {
    const warnings = [
      ...(runtime?.warnings ?? []).map((warning) => warning.message),
      ...(dashboardData.gpuStatus?.warnings ?? []).map((warning) => warning.message)
    ];
    const warningText = warnings.join(" ").toLowerCase();
    const gpuWarning = warningText.includes("vram") || warningText.includes("gpu") || (dashboardData.gpuStatus?.summary.warningsCount ?? 0) > 0;
    const catalogState = router?.catalog?.reconciliationState ?? "unknown";
    const presetState = router?.generatedArtifact?.freshness ?? "unknown";
    const managedPort = dashboardData.readiness?.managedPort;
    const processAwareness = dashboardData.processes;

    return [
      { label: "Backend API", state: runtime ? "Reachable" : "Unavailable", tone: runtime ? "ok" : "error" },
      { label: "Router ownership", state: router?.startedByObsidianLM ? "Managed" : router ? router.ownershipEvidence : "Unknown", tone: router?.startedByObsidianLM ? "ok" : router ? "warn" : "muted" },
      { label: "Router health", state: router?.health.state ?? "Unknown", tone: router?.health.state === "healthy" ? "ok" : isRunning ? "warn" : "muted" },
      { label: "Build eligible", state: activeBuild?.managedInferenceEligibility ?? "Unknown", tone: activeBuild?.managedInferenceEligibility === "eligible" ? "ok" : activeBuild ? "warn" : "muted" },
      { label: "Preset current", state: presetState, tone: presetState === "current" ? "ok" : presetState === "stale" ? "warn" : "muted" },
      { label: "Catalog reconciled", state: catalogState, tone: catalogState === "reconciled" ? "ok" : catalogState === "mismatch" || catalogState === "failed" ? "error" : "muted" },
      { label: "Managed port", state: managedPort ? (managedPort.conflict ? "Conflict" : managedPort.inUse ? "In use" : "Stopped") : "Unknown", tone: managedPort?.conflict ? "error" : managedPort?.inUse ? "ok" : "muted" },
      { label: "GPU-process awareness", state: processAwareness?.available === false ? "Unavailable" : gpuWarning ? "Warning" : processAwareness ? "Known" : "Unknown", tone: processAwareness?.available === false ? "muted" : gpuWarning ? "warn" : processAwareness ? "ok" : "muted" },
      { label: "Runtime uncertainty", state: router?.previousRuntimeUncertainty ? "Review" : "None", tone: router?.previousRuntimeUncertainty ? "warn" : router ? "ok" : "muted" }
    ];
  }

  function gpuLayersLabel(): string {
    if (llamaArgs?.gpuLayers === undefined) {
      return "—";
    }
    return llamaArgs.gpuLayers === "all" ? "All layers" : `${llamaArgs.gpuLayers} layers`;
  }

  function kvCacheLabel(): string {
    const key = llamaArgs?.cacheTypeK ?? "—";
    const value = llamaArgs?.cacheTypeV ?? "—";
    return `${key} / ${value}`;
  }

  function logType(message: string, source: string, origin: string, configuredModelId?: string): string {
    const tone = inferLogTone(message);
    if (tone === "amber") return "WARN";
    if (tone === "red") return "ERR";
    if (configuredModelId || origin.includes("child")) return "MODEL";
    if (origin === "router") return "ROUTER";
    return source === "system" ? "SYSTEM" : "SYSTEM";
  }

  function logToneClass(message: string, source: string, origin: string, configuredModelId?: string): string {
    const type = logType(message, source, origin, configuredModelId);
    if (type === "WARN") return "warn";
    if (type === "ERR") return "error";
    if (type === "ROUTER" || type === "MODEL") return "run";
    return "info";
  }

  function configuredModelName(id?: string): string {
    return dashboardData.configuredModels.find((model) => model.id === id)?.displayName ?? id ?? "Unknown configured model";
  }

  function managedModelVram(gpu: NonNullable<GpuMonitoringStatus["gpus"]>[number]): number | null {
    if (!activeModelId) return null;
    const memory = gpu.processes
      .filter((process) => (process.kind === "managed_router_child" || process.kind === "current_managed_runtime") && process.configuredModelId === activeModelId)
      .filter((process) => dashboardData.processes?.processes.some((detected) => detected.pid === process.pid && detected.ownership === "proven" && detected.configuredModelId === activeModelId))
      .reduce((total, process) => total + (process.usedMemoryMiB ?? 0), 0);
    return memory > 0 ? memory : null;
  }

  function deviceRole(index: number): string {
    if (index === 0) return "Primary GPU";
    if (index === 1) return "Secondary GPU";
    return `GPU ${index + 1}`;
  }

  function meterWidth(value: number): string {
    return `width: ${clampPercent(value)}%`;
  }

  function powerPercent(gpu: NonNullable<GpuMonitoringStatus["gpus"]>[number]): number {
    if (typeof gpu.powerDrawW !== "number" || typeof gpu.powerLimitW !== "number" || gpu.powerLimitW <= 0) {
      return 0;
    }
    return (gpu.powerDrawW / gpu.powerLimitW) * 100;
  }

  onMount(() => {
    poller = createCompletionAwarePoller(refreshDashboardData, 5000);
    poller.start();

    return () => {
      refreshGeneration += 1;
      poller?.stop();
    };
  });
</script>

<main class="page-surface dashboard-page" aria-label="Dashboard">
  <PageHeader title="Dashboard" subtitle="Control and monitor your local llama.cpp runtimes with precision." />

  <div class="dashboard-grid">
    <div class="left-column">
      <section class="panel hero" aria-label="Runtime control hero">
        <div class="hero-main">
           <div class:muted={!isRunning} class="hero-status-line"><StatusDot tone={runtimeTone} />{runtimeLabel}</div>
          <h2 class="hero-title">{heroTitle}</h2>
          <p class="hero-subtitle">{heroSubtitle}</p>

          <button class="endpoint-copy" type="button" on:click={copyEndpoint} aria-label="Copy endpoint">
            <span>{endpoint}</span>
            <span class="copy-state"><Icon name="copy" size={15} /><span>{copyLabel}</span></span>
          </button>

          <div class="hero-meta">
            <div class="hero-stat"><div class="label">Build</div><div class="value">{activeBuild?.displayName ?? router?.activeBuildId ?? "—"}</div></div>
             <div class="hero-stat"><div class="label">Loaded model</div><div class="value">{activeModelLabel ?? (loadedStates.length > 1 ? `${loadedStates.length} loaded · policy warning` : "None")}</div></div>
            <div class="hero-stat"><div class="label">PID</div><div class="value">{pidLabel}</div></div>
            <div class="hero-stat"><div class="label">Uptime</div><div class="value">{uptimeLabel}</div></div>
          </div>
        </div>

        <div class="hero-side">
          <div class="runtime-control">
            <div class="control-title-row">
              <strong>Router controls</strong>
               <span class="mini-pill"><StatusDot tone={runtimeTone} />{router?.health.state ?? routerStatus}</span>
            </div>
            <div class="control-grid">
              <button class:primary={isRunning} class:disabled={!isRunning || actionPending || isTransitioning} class="btn" type="button" disabled={!isRunning || actionPending || isTransitioning} on:click={() => runRuntimeAction("restart")}><Icon name="refresh" size={16} />Restart router</button>
              <button class:disabled={!isRunning || actionPending || isTransitioning} class="btn" type="button" disabled={!isRunning || actionPending || isTransitioning} on:click={() => runRuntimeAction("stop")}><Icon name="stop" size={16} />Stop router</button>
              {#if !isRunning}
                 <a class="btn wide" href="#runtime"><Icon name="terminal" size={16} />Open Runtime to start</a>
              {/if}
            </div>
            {#if actionError}<div class="runtime-micro">{actionError}</div>{/if}
            <div class="runtime-micro">
              <span>Router</span><span>{routerStatus}</span>
              <span>Build</span><span>{activeBuild?.displayName ?? router?.activeBuildId ?? "—"}</span>
              <span>Models</span><span>{modelStates.length}</span>
              <span>Last started</span><span>{router?.startedAt ? formatTimestamp(router.startedAt) : "—"}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="panel quick-actions" aria-label="Quick actions">
        <div class="panel-head compact"><h2 class="section-title">Quick Actions</h2></div>
        <div class="quick-grid">
          <a class="quick-action" href="#profiles"><div class="quick-icon"><Icon name="zap" size={20} /></div><div class="quick-text"><strong>Manage configurations</strong><span>Profiles</span></div></a>
          <a class="quick-action" href="#models"><div class="quick-icon"><Icon name="load" size={20} /></div><div class="quick-text"><strong>Browse models</strong><span>Inspect primary models</span></div></a>
          <a class="quick-action" href="#builds"><div class="quick-icon"><Icon name="terminal" size={20} /></div><div class="quick-text"><strong>Inspect Builds</strong><span>Builds</span></div></a>
          <a class="quick-action" href="#jobs"><div class="quick-icon cyan"><Icon name="shield" size={20} /></div><div class="quick-text"><strong>Run jobs</strong><span>Jobs</span></div></a>
        </div>
      </section>

      <section class="panel profile-details" aria-label="Active runtime details">
        <div class="panel-head compact"><h2 class="section-title">Active Runtime Details</h2></div>
        <div class="profile-grid">
          <div class="detail-group">
            <h3>Router</h3>
            <div class="kv-list">
              <div class="kv-row"><span>Build</span><span>{activeBuild?.displayName ?? router?.activeBuildId ?? "—"}</span></div>
              <div class="kv-row"><span>Status</span><span>{routerStatus}</span></div>
              <div class="kv-row"><span>Health</span><span>{router?.health.state ?? "unknown"}</span></div>
              <div class="kv-row"><span>Catalog</span><span>{router?.catalog?.reconciliationState ?? "unknown"}</span></div>
              <div class="kv-row"><span>Preset</span><span>{router?.generatedArtifact?.freshness ?? "unknown"}</span></div>
              <div class="kv-row"><span>Endpoint</span><span>{endpoint}</span></div>
            </div>
          </div>
          <div class="detail-group">
            <h3>Model</h3>
            <div class="kv-list">
               <div class="kv-row"><span>Name</span><span>{activeModelLabel ?? "—"}</span></div>
              <div class="kv-row"><span>Alias</span><span>{activeModel?.routerAlias ?? "—"}</span></div>
              <div class="kv-row"><span>Text / Vision</span><span>{activeModel ? visionCapabilityKind(activeModel.artifact?.vision?.capability) : "—"}</span></div>
              <div class="kv-row"><span>Context</span><span>{formatNumber(activeModel?.artifact?.metadata?.trainedContext ?? llamaArgs?.ctxSize)}</span></div>
              <div class="kv-row"><span>GPU offload</span><span>{gpuLayersLabel()}</span></div>
              <div class="kv-row"><span>KV cache</span><span>{kvCacheLabel()}</span></div>
            </div>
          </div>
        </div>
         {#if loadedStates.length === 0}<div class="empty-state compact-empty">No configured model is loaded in the managed router.</div>{:else if loadedStates.length === 1 && !activeModel}<div class="empty-state compact-empty">The router reports {activeModelId} loaded; configuration details are unavailable.</div>{:else if loadedStates.length > 1}<div class="empty-state compact-empty">Multiple configured models report loaded; review router catalog reconciliation.</div>{/if}
      </section>

      <section class="panel events-card" aria-label="Recent events">
        <div class="panel-head compact"><h2 class="section-title">Recent Events</h2><a href="#logs">View logs</a></div>
        <div class="event-stream">
          {#if recentLogs.length > 0}
            {#each recentLogs as log}
              <div class="event-line">
                <span class="event-time">{formatTimestamp(log.timestamp)}</span>
                <span class={`event-type ${logToneClass(log.message, log.source, log.origin, log.configuredModelId)}`}>{logType(log.message, log.source, log.origin, log.configuredModelId)}</span>
                <span class="event-message" title={log.message}>{log.configuredModelId ? `${configuredModelName(log.configuredModelId)}: ` : log.origin === "unknown" ? "Unknown or older event: " : ""}{log.message}</span>
              </div>
            {/each}
          {:else}
            <div class="empty-state">No runtime log entries recorded yet.</div>
          {/if}
        </div>
      </section>
    </div>

    <div class="right-column">
      <section class="panel health-card" aria-label="Health checklist">
        <div class="panel-head compact"><h2 class="section-title">Health Checklist</h2><span class="mini-pill">{healthOkCount}/{healthItems.length} OK</span></div>
        <div class="health-list">
          {#each healthItems as item}
            <div class:warn={item.tone === "warn"} class:error={item.tone === "error"} class:muted={item.tone === "muted"} class="health-item">
              <StatusDot tone={item.tone === "ok" ? "green" : item.tone === "warn" ? "amber" : item.tone === "error" ? "red" : "muted"} />{item.label}<strong>{item.state}</strong>
            </div>
          {/each}
        </div>
      </section>

      <section class="panel resource-snapshot" aria-label="Resource snapshot">
        <div class="panel-head compact"><h2 class="section-title">Resource Snapshot</h2><a href="#telemetry">View telemetry</a></div>
        <div class="resource-body">
          {#if gpuDevices.length > 0}
            {#each gpuDevices as gpu, index}
              <div class="device-card">
                <div class="device-head"><div class="device-title"><Icon name="gpu" size={18} /><strong>{gpu.name}</strong></div><div class="device-role">{deviceRole(index)}</div></div>
                <div class="meter-grid">
                  <div class="meter"><div class="meter-top"><span>VRAM</span><span>{formatVramMiB(gpu.memoryUsedMiB)} / {formatVramMiB(gpu.memoryTotalMiB)}</span></div><div class="meter-bar"><span style={meterWidth(vramPercent(gpu.memoryUsedMiB, gpu.memoryTotalMiB))}></span></div></div>
                  <div class="meter"><div class="meter-top"><span>Core usage</span><span>{formatUtilization(gpu.utilizationGpuPercent)}</span></div><div class="meter-bar"><span style={meterWidth(gpu.utilizationGpuPercent ?? 0)}></span></div></div>
                  <div class="meter"><div class="meter-top"><span>Temperature</span><span>{formatTemperature(gpu.temperatureGpuC)}</span></div><div class="meter-bar"><span style={meterWidth(gpu.temperatureGpuC ?? 0)}></span></div></div>
                  <div class="meter"><div class="meter-top"><span>Power</span><span>{formatPowerWatts(gpu.powerDrawW)}</span></div><div class="meter-bar"><span style={meterWidth(powerPercent(gpu))}></span></div></div>
                  {#if managedModelVram(gpu) !== null}<div class="meter"><div class="meter-top"><span>Managed model VRAM</span><span>{formatVramMiB(managedModelVram(gpu))}</span></div></div>{/if}
                </div>
              </div>
            {/each}
          {:else}
            <div class="device-card unavailable"><div class="device-head"><div class="device-title"><Icon name="gpu" size={18} /><strong>GPU telemetry</strong></div><div class="device-role">Unavailable</div></div><div class="empty-state compact-empty">No GPU devices reported by monitoring.</div></div>
          {/if}
        </div>
      </section>
    </div>
  </div>
</main>

<style>
  .dashboard-page {
    height: calc(100vh - var(--topbar-height));
  }

  .dashboard-grid {
    margin-top: 16px;
    display: grid;
    grid-template-columns: minmax(0, 1.45fr) minmax(340px, 0.9fr);
    gap: 10px;
    padding-bottom: 26px;
  }

  .left-column,
  .right-column {
    min-width: 0;
    display: grid;
    gap: 10px;
    align-content: start;
  }

  .panel-head.compact {
    padding: 0;
  }

  .panel-head.compact a {
    color: #85e9f4;
    font-size: 12px;
    font-weight: 750;
  }

  .hero {
    min-height: 214px;
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(310px, 0.8fr);
    gap: 16px;
    padding: 18px;
  }

  .hero::before {
    content: "";
    position: absolute;
    inset: -1px;
    background:
      radial-gradient(circle at 20% 15%, rgba(143, 92, 255, 0.16), transparent 28%),
      radial-gradient(circle at 78% 10%, rgba(66, 215, 232, 0.11), transparent 30%);
    pointer-events: none;
  }

  .hero-main,
  .hero-side {
    position: relative;
    z-index: 1;
  }

  .hero-status-line {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--color-green);
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .hero-status-line.muted {
    color: var(--color-muted);
  }

  .hero-title {
    margin-top: 13px;
    font-size: 25px;
    font-weight: 760;
    color: #f4f7ff;
    letter-spacing: -0.03em;
  }

  .hero-subtitle {
    margin-top: 6px;
    color: #9fabc0;
    font-size: 13px;
    line-height: 1.55;
  }

  .endpoint-copy {
    margin-top: 16px;
    width: min(100%, 560px);
    min-height: 43px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 12px 0 14px;
    border: 1px solid rgba(66, 215, 232, 0.22);
    border-radius: var(--radius-md);
    color: #85e9f4;
    background: rgba(8, 18, 31, 0.78);
    font-family: var(--font-mono);
    font-size: 13px;
    cursor: pointer;
    box-shadow: inset 0 1px 18px rgba(0, 0, 0, 0.24);
  }

  .endpoint-copy span:first-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .copy-state {
    color: #b9c7d9;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .hero-meta {
    margin-top: 14px;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }

  .hero-stat {
    min-height: 58px;
    padding: 10px 11px;
    border: 1px solid rgba(132, 153, 188, 0.13);
    border-radius: var(--radius-sm);
    background: rgba(8, 16, 28, 0.58);
  }

  .label {
    color: #7f8da3;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .value {
    margin-top: 7px;
    color: #e1e8f5;
    font-size: 13px;
    font-weight: 760;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .runtime-control {
    min-height: 100%;
    display: grid;
    gap: 10px;
    align-content: start;
    padding: 14px;
    border: 1px solid rgba(132, 153, 188, 0.14);
    border-radius: var(--radius-md);
    background: rgba(8, 16, 29, 0.66);
    box-shadow: inset 0 1px 20px rgba(0, 0, 0, 0.18);
  }

  .control-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 3px;
  }

  .control-title-row strong {
    color: #e8eefb;
    font-size: 14px;
    font-weight: 850;
  }

  .control-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .btn {
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0 12px;
    border: 1px solid rgba(132, 153, 188, 0.18);
    border-radius: var(--radius-sm);
    color: #d8e1ee;
    background: rgba(14, 24, 40, 0.78);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
    font-size: 13px;
    font-weight: 780;
  }

  .btn.primary {
    color: #fff;
    border-color: rgba(177, 137, 255, 0.52);
    background: linear-gradient(180deg, rgba(127, 75, 232, 0.95), rgba(79, 49, 147, 0.95));
    box-shadow: 0 10px 26px rgba(101, 63, 209, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.18);
  }

  .btn.disabled,
  .btn:disabled {
    opacity: 0.42;
    filter: saturate(0.65);
    cursor: not-allowed;
  }

  .btn.wide {
    grid-column: span 2;
  }

  .runtime-micro {
    display: grid;
    grid-template-columns: 1fr auto;
    row-gap: 9px;
    column-gap: 14px;
    padding-top: 6px;
    color: #9cabc0;
    font-size: 12px;
  }

  .runtime-micro span:nth-child(even) {
    max-width: 220px;
    color: #d6dfec;
    font-family: var(--font-mono);
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .quick-actions,
  .profile-details,
  .events-card,
  .health-card,
  .resource-snapshot {
    padding: 15px 16px 16px;
  }

  .quick-grid {
    margin-top: 12px;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 9px;
  }

  .quick-action {
    min-height: 70px;
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 12px;
    border: 1px solid rgba(132, 153, 188, 0.14);
    border-radius: var(--radius-sm);
    background: rgba(10, 20, 36, 0.68);
    color: inherit;
    text-decoration: none;
  }

  .quick-icon {
    width: 35px;
    height: 35px;
    display: grid;
    place-items: center;
    border: 1px solid rgba(143, 92, 255, 0.26);
    border-radius: 9px;
    color: #a073ff;
    background: rgba(143, 92, 255, 0.12);
    flex: 0 0 auto;
  }

  .quick-icon.cyan {
    color: #83e7f2;
    border-color: rgba(66, 215, 232, 0.25);
    background: rgba(66, 215, 232, 0.1);
  }

  .quick-text {
    min-width: 0;
    display: grid;
    gap: 4px;
  }

  .quick-text strong,
  .quick-text span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .quick-text strong {
    color: #e4ebf6;
    font-size: 13px;
    font-weight: 800;
  }

  .quick-text span {
    color: #8795aa;
    font-size: 12px;
    font-weight: 650;
  }

  .profile-grid {
    margin-top: 13px;
    display: grid;
    grid-template-columns: 1.1fr 0.9fr;
    gap: 10px;
  }

  .detail-group,
  .device-card {
    border: 1px solid rgba(132, 153, 188, 0.13);
    border-radius: var(--radius-sm);
    background: rgba(8, 16, 29, 0.52);
    overflow: hidden;
  }

  .detail-group h3 {
    padding: 11px 12px 8px;
    color: #c6d0df;
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    border-bottom: 1px solid rgba(132, 153, 188, 0.11);
  }

  .kv-list {
    padding: 6px 12px 10px;
  }

  .kv-row {
    display: grid;
    grid-template-columns: minmax(120px, 1fr) auto;
    gap: 16px;
    padding: 7px 0;
    border-bottom: 1px solid rgba(132, 153, 188, 0.08);
    font-size: 13px;
  }

  .kv-row:last-child {
    border-bottom: 0;
  }

  .kv-row span:first-child {
    color: #8997ac;
    font-weight: 650;
  }

  .kv-row span:last-child {
    color: #dbe5f4;
    font-family: var(--font-mono);
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .path-value {
    max-width: 330px;
    display: inline-block;
    vertical-align: bottom;
  }

  .event-stream {
    margin-top: 12px;
    height: 430px;
    padding: 12px;
    border: 1px solid rgba(132, 153, 188, 0.13);
    border-radius: var(--radius-sm);
    background: rgba(4, 7, 12, 0.62);
    overflow: hidden;
    font-family: var(--font-mono);
    box-shadow: inset 0 1px 22px rgba(0, 0, 0, 0.32);
  }

  .event-line {
    display: grid;
    grid-template-columns: 78px 54px minmax(0, 1fr);
    gap: 10px;
    min-height: 25px;
    color: #c6d0de;
    font-size: 12px;
    line-height: 1.45;
  }

  .event-time {
    color: #8998ab;
  }

  .event-type {
    font-weight: 900;
  }

  .event-type.info {
    color: #54d983;
  }

  .event-type.warn {
    color: var(--color-amber);
  }

  .event-type.error {
    color: var(--color-red);
  }

  .event-type.run {
    color: #82e9f4;
  }

  .event-message,
  .device-title strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-state {
    height: 100%;
    display: grid;
    place-items: center;
    color: #7e8da4;
    font-size: 13px;
    text-align: center;
  }

  .compact-empty {
    min-height: 74px;
    padding: 16px;
  }

  .health-list,
  .resource-body {
    margin-top: 13px;
    display: grid;
    gap: 8px;
  }

  .resource-body {
    margin-top: 12px;
    gap: 9px;
  }

  .health-item {
    min-height: 42px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 11px;
    border: 1px solid rgba(132, 153, 188, 0.12);
    border-radius: var(--radius-sm);
    background: rgba(8, 16, 29, 0.46);
    color: #b6c2d4;
    font-size: 13px;
    font-weight: 690;
  }

  .health-item strong {
    margin-left: auto;
    color: var(--color-green);
    font-size: 12px;
    font-weight: 850;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .health-item.warn strong {
    color: var(--color-amber);
  }

  .health-item.error strong {
    color: var(--color-red);
  }

  .health-item.muted strong {
    color: #758399;
  }

  .device-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 39px;
    padding: 10px 11px;
    border-bottom: 1px solid rgba(132, 153, 188, 0.09);
  }

  .device-title {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 9px;
    color: #e3ebf7;
    font-size: 13px;
    font-weight: 820;
  }

  .device-role {
    color: #8c9ab0;
    font-size: 11px;
    font-weight: 850;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
  }

  .meter-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 14px;
    padding: 11px;
  }

  .meter {
    min-width: 0;
  }

  .meter-top {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: #8d9bae;
    font-size: 12px;
    font-weight: 700;
  }

  .meter-top span:last-child {
    color: #d3deec;
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: nowrap;
  }

  @media (max-width: 1380px) {
    .dashboard-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .right-column {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: start;
    }

    .resource-snapshot {
      grid-column: span 2;
    }
  }

  @media (max-width: 1120px) {
    .hero,
    .profile-grid,
    .right-column {
      grid-template-columns: minmax(0, 1fr);
    }

    .quick-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .resource-snapshot {
      grid-column: auto;
    }
  }

  @media (max-width: 720px) {
    .dashboard-page {
      height: auto;
    }

    .hero {
      padding: 14px;
    }

    .hero-meta {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .control-grid,
    .quick-grid,
    .meter-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .btn.wide {
      grid-column: auto;
    }

    .event-line {
      grid-template-columns: 66px 48px 1fr;
    }
  }
</style>
