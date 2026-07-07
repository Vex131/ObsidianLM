<script lang="ts">
  import { onMount } from "svelte";
  import PageHeader from "../components/PageHeader.svelte";
  import Icon from "../components/Icon.svelte";
  import StatusDot from "../components/StatusDot.svelte";
  import { API_ENDPOINTS, fetchJson, readStoredAdminToken, type GpuMonitoringStatus, type RuntimeActionResult, type RuntimeState, type StatusResponse } from "../api";
  import { emptyDashboardData, fetchDashboardData, type DashboardData } from "../dashboard/dashboard-data";
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
    normalizeEndpoint,
    vramPercent
  } from "../dashboard/dashboard-format";
  import { defaultShellStatus, type ShellStatusSummary } from "../layout/shell-status";

  export let shellStatus: ShellStatusSummary = defaultShellStatus;
  export let status: StatusResponse | null = null;
  export let runtimeState: RuntimeState | null = null;
  export let runtimeWarnings: string[] = [];

  type HealthTone = "ok" | "warn" | "error" | "muted";
  type HealthItem = { label: string; state: string; tone: HealthTone };

  let dashboardData: DashboardData = emptyDashboardData;
  let copyLabel = "Copy";
  let actionPending = false;
  let refreshTimer: number | null = null;

  $: activeRuntime = dashboardData.runtimeState ?? runtimeState;
  $: activeProfileId = activeRuntime?.activeProfileId ?? status?.activeRuntime?.profileId ?? null;
  $: activeProfile = dashboardData.profiles.find((profile) => profile.id === activeProfileId) ?? null;
  $: runtimeStatus = activeRuntime?.status ?? status?.activeRuntime?.status ?? "stopped";
  $: isRunning = runtimeStatus === "running";
  $: isTransitioning = runtimeStatus === "starting" || runtimeStatus === "stopping";
  $: hasToken = dashboardData.hasToken || Boolean(readStoredAdminToken());
  $: endpoint = normalizeEndpoint(status, activeProfile);
  $: heroTitle = status?.activeRuntime?.profileName ?? activeProfile?.name ?? (activeProfileId ? activeProfileId : "No active profile");
  $: heroSubtitle = runtimeSubtitle(runtimeStatus);
  $: runtimeLabel = shellStatus.runtimeLabel.replace(/^Runtime\s+/i, "Runtime ");
  $: profileLabel = activeProfile?.name ?? status?.activeRuntime?.profileName ?? "—";
  $: portLabel = String(activeRuntime?.port ?? activeProfile?.port ?? status?.managedLlamaPort ?? shellStatus.portLabel ?? "—");
  $: pidLabel = activeRuntime?.pid ? String(activeRuntime.pid) : status?.activeRuntime?.pid ? String(status.activeRuntime.pid) : "—";
  $: uptimeLabel = formatUptime(activeRuntime?.startedAt);
  $: llamaArgs = activeProfile?.llamaArgs;
  $: healthItems = buildHealthItems();
  $: healthOkCount = healthItems.filter((item) => item.tone === "ok").length;
  $: gpuDevices = dashboardData.gpuStatus?.gpus ?? [];
  $: recentLogs = dashboardData.runtimeLogs.slice().reverse();

  async function refreshDashboardData() {
    dashboardData = await fetchDashboardData(activeProfileId);
  }

  async function runRuntimeAction(action: "restart" | "stop" | "start") {
    if (actionPending || !hasToken) {
      return;
    }

    const url = action === "restart"
      ? API_ENDPOINTS.runtime.restart
      : action === "stop"
        ? API_ENDPOINTS.runtime.stop
        : activeProfileId
          ? API_ENDPOINTS.profiles.start(activeProfileId)
          : null;

    if (!url) {
      return;
    }

    actionPending = true;
    try {
      await fetchJson<RuntimeActionResult>(url, { method: "POST" });
      await refreshDashboardData();
    } catch {
      // Runtime action failures are surfaced through the refreshed status/log panels.
      await refreshDashboardData();
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

  function runtimeSubtitle(currentStatus: string): string {
    if (currentStatus === "running") {
      return "llama.cpp runtime is active with the selected profile. Endpoint is ready for local tools and agents.";
    }
    if (currentStatus === "starting") {
      return "Runtime startup is in progress. Controls are paused until the process reports a stable state.";
    }
    if (currentStatus === "stopping") {
      return "Runtime shutdown is in progress. The dashboard will refresh when the process exits.";
    }
    if (currentStatus === "failed" || currentStatus === "exited") {
      return "The last runtime did not remain active. Check recent events and profile details before restarting.";
    }
    return "No llama.cpp runtime is currently active. Select a profile, validate setup, then start when ready.";
  }

  function buildHealthItems(): HealthItem[] {
    const warnings = [
      ...(status?.warnings ?? []),
      ...(status?.detection?.warnings ?? []).map((warning) => warning.message),
      ...runtimeWarnings,
      ...dashboardData.runtimeWarnings,
      ...(dashboardData.gpuStatus?.warnings ?? []).map((warning) => warning.message)
    ];
    const warningText = warnings.join(" ").toLowerCase();
    const gpuWarning = warningText.includes("vram") || warningText.includes("gpu") || (dashboardData.gpuStatus?.summary.warningsCount ?? 0) > 0;
    const hasBuild = Boolean(activeProfile?.buildPath);
    const hasModel = Boolean(activeProfile?.modelPath);
    const stale = runtimeStatus === "unknown_previous_runtime";

    return [
      { label: "Backend API reachable", state: status ? "OK" : "Error", tone: status ? "ok" : "error" },
      { label: "Runtime process detected", state: activeRuntime?.pid ? "OK" : isRunning ? "Warn" : "Idle", tone: activeRuntime?.pid ? "ok" : isRunning ? "warn" : "muted" },
      { label: "Endpoint responding", state: isRunning && endpoint !== "—" ? "OK" : "Idle", tone: isRunning && endpoint !== "—" ? "ok" : "muted" },
      { label: "Model file exists", state: hasModel ? "OK" : "Missing", tone: hasModel ? "ok" : "muted" },
      { label: "Build path configured", state: hasBuild ? "OK" : "Missing", tone: hasBuild ? "ok" : "muted" },
      { label: "VRAM headroom low / GPU warnings", state: gpuWarning ? "Warn" : dashboardData.gpuStatus ? "OK" : "—", tone: gpuWarning ? "warn" : dashboardData.gpuStatus ? "ok" : "muted" },
      { label: "Admin token loaded", state: hasToken ? "OK" : "Locked", tone: hasToken ? "ok" : "muted" },
      { label: "No stale process", state: stale ? "Warn" : "OK", tone: stale ? "warn" : "ok" }
    ];
  }

  function contextReuseLabel(): string {
    if (llamaArgs?.contBatching === undefined) {
      return "—";
    }
    return llamaArgs.contBatching ? "Enabled" : "Disabled";
  }

  function flashAttentionLabel(): string {
    if (llamaArgs?.flashAttention === undefined) {
      return "—";
    }
    return llamaArgs.flashAttention ? "Enabled" : "Disabled";
  }

  function gpuLayersLabel(): string {
    if (llamaArgs?.gpuLayers === undefined) {
      return "—";
    }
    return llamaArgs.gpuLayers === "all" ? "All layers" : `${llamaArgs.gpuLayers} layers`;
  }

  function batchLabel(): string {
    const batch = llamaArgs?.batchSize ? formatNumber(llamaArgs.batchSize) : "—";
    const ubatch = llamaArgs?.ubatchSize ? formatNumber(llamaArgs.ubatchSize) : "—";
    return `${batch} / ${ubatch}`;
  }

  function kvCacheLabel(): string {
    const key = llamaArgs?.cacheTypeK ?? "—";
    const value = llamaArgs?.cacheTypeV ?? "—";
    return `${key} / ${value}`;
  }

  function logType(message: string, source: string): string {
    const tone = inferLogTone(message);
    if (tone === "amber") return "WARN";
    if (tone === "red") return "ERR";
    if (/listening|started|loaded|runtime/i.test(message)) return "RUN";
    return source === "stderr" ? "ERR" : "INFO";
  }

  function logToneClass(message: string, source: string): string {
    const type = logType(message, source);
    if (type === "WARN") return "warn";
    if (type === "ERR") return "error";
    if (type === "RUN") return "run";
    return "info";
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
    void refreshDashboardData();
    refreshTimer = window.setInterval(() => void refreshDashboardData(), 5000);

    return () => {
      if (refreshTimer) {
        window.clearInterval(refreshTimer);
      }
    };
  });
</script>

<main class="page-surface dashboard-page" aria-label="Dashboard">
  <PageHeader title="Dashboard" subtitle="Control and monitor your local llama.cpp runtimes with precision." />

  <div class="dashboard-grid">
    <div class="left-column">
      <section class="panel hero" aria-label="Runtime control hero">
        <div class="hero-main">
          <div class:muted={!isRunning} class="hero-status-line"><StatusDot tone={shellStatus.runtimeTone} />{runtimeLabel}</div>
          <h2 class="hero-title">{heroTitle}</h2>
          <p class="hero-subtitle">{heroSubtitle}</p>

          <button class="endpoint-copy" type="button" on:click={copyEndpoint} aria-label="Copy endpoint">
            <span>{endpoint}</span>
            <span class="copy-state"><Icon name="copy" size={15} /><span>{copyLabel}</span></span>
          </button>

          <div class="hero-meta">
            <div class="hero-stat"><div class="label">Profile</div><div class="value">{profileLabel}</div></div>
            <div class="hero-stat"><div class="label">Port</div><div class="value">{portLabel}</div></div>
            <div class="hero-stat"><div class="label">PID</div><div class="value">{pidLabel}</div></div>
            <div class="hero-stat"><div class="label">Uptime</div><div class="value">{uptimeLabel}</div></div>
          </div>
        </div>

        <div class="hero-side">
          <div class="runtime-control">
            <div class="control-title-row">
              <strong>Runtime controls</strong>
              <span class="mini-pill"><StatusDot tone={shellStatus.runtimeTone} />{isRunning ? "Healthy" : shellStatus.runtimeLabel.replace(/^Runtime\s+/i, "")}</span>
            </div>
            <div class="control-grid">
              <button class:primary={isRunning} class:disabled={!isRunning || actionPending || isTransitioning || !hasToken} class="btn" type="button" disabled={!isRunning || actionPending || isTransitioning || !hasToken} on:click={() => runRuntimeAction("restart")}><Icon name="refresh" size={16} />Restart</button>
              <button class:disabled={!isRunning || actionPending || isTransitioning || !hasToken} class="btn" type="button" disabled={!isRunning || actionPending || isTransitioning || !hasToken} on:click={() => runRuntimeAction("stop")}><Icon name="stop" size={16} />Stop</button>
              <button class:primary={!isRunning && Boolean(activeProfileId)} class:disabled={isRunning || actionPending || isTransitioning || !activeProfileId || !hasToken} class="btn wide" type="button" disabled={isRunning || actionPending || isTransitioning || !activeProfileId || !hasToken} on:click={() => runRuntimeAction("start")}><Icon name="play" size={16} />Start runtime</button>
            </div>
            <div class="runtime-micro">
              <span>Runtime</span><span>llama-server</span>
              <span>Build</span><span title={activeProfile?.buildPath ?? ""}>{activeProfile?.buildPath?.split(/[\\/]/).pop() ?? "—"}</span>
              <span>Model</span><span title={activeProfile?.modelPath ?? ""}>{activeProfile?.modelPath?.split(/[\\/]/).pop() ?? "—"}</span>
              <span>Last started</span><span>{activeRuntime?.startedAt ? formatTimestamp(activeRuntime.startedAt) : "—"}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="panel quick-actions" aria-label="Quick actions">
        <div class="panel-head compact"><h2 class="section-title">Quick Actions</h2></div>
        <div class="quick-grid">
          <a class="quick-action" href="#profiles"><div class="quick-icon"><Icon name="zap" size={20} /></div><div class="quick-text"><strong>Switch profile</strong><span>Change active profile</span></div></a>
          <a class="quick-action" href="#models"><div class="quick-icon"><Icon name="load" size={20} /></div><div class="quick-text"><strong>Load model</strong><span>Select GGUF file</span></div></a>
          <a class="quick-action" href="#settings"><div class="quick-icon cyan"><Icon name="shield" size={20} /></div><div class="quick-text"><strong>Validate setup</strong><span>Run health checks</span></div></a>
        </div>
      </section>

      <section class="panel profile-details" aria-label="Active profile details">
        <div class="panel-head compact"><h2 class="section-title">Active Profile Details</h2></div>
        <div class="profile-grid">
          <div class="detail-group">
            <h3>Launch configuration</h3>
            <div class="kv-list">
              <div class="kv-row"><span>Context size</span><span>{formatNumber(llamaArgs?.ctxSize)}</span></div>
              <div class="kv-row"><span>GPU offload</span><span>{gpuLayersLabel()}</span></div>
              <div class="kv-row"><span>Context reuse</span><span>{contextReuseLabel()}</span></div>
              <div class="kv-row"><span>Parallel slots</span><span>{formatNumber(llamaArgs?.parallel)}</span></div>
              <div class="kv-row"><span>Batch / ubatch</span><span>{batchLabel()}</span></div>
            </div>
          </div>
          <div class="detail-group">
            <h3>Memory &amp; model</h3>
            <div class="kv-list">
              <div class="kv-row"><span>KV cache</span><span>{kvCacheLabel()}</span></div>
              <div class="kv-row"><span>Flash attention</span><span>{flashAttentionLabel()}</span></div>
              <div class="kv-row"><span>Tensor split</span><span>{llamaArgs?.tensorSplit ?? "—"}</span></div>
              <div class="kv-row"><span>Model path</span><span class="path-value" title={activeProfile?.modelPath ?? ""}>{activeProfile?.modelPath ?? "—"}</span></div>
              <div class="kv-row"><span>Profile file / profile id</span><span>{activeProfile?.id ?? activeProfileId ?? "—"}</span></div>
            </div>
          </div>
        </div>
      </section>

      <section class="panel events-card" aria-label="Recent events">
        <div class="panel-head compact"><h2 class="section-title">Recent Events</h2><span class="mini-pill"><StatusDot tone={hasToken ? "green" : "muted"} />{hasToken ? "Live tail" : "Token required"}</span></div>
        <div class="event-stream">
          {#if recentLogs.length > 0}
            {#each recentLogs as log}
              <div class="event-line">
                <span class="event-time">{formatTimestamp(log.timestamp)}</span>
                <span class={`event-type ${logToneClass(log.message, log.source)}`}>{logType(log.message, log.source)}</span>
                <span class="event-message" title={log.message}>{log.message}</span>
              </div>
            {/each}
          {:else}
            <div class="empty-state">{hasToken ? "No runtime log entries recorded yet." : "Load an admin token to show protected runtime logs."}</div>
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
        <div class="panel-head compact"><h2 class="section-title">Resource Snapshot</h2><span class="mini-pill"><StatusDot tone={gpuDevices.length > 0 ? "green" : "muted"} />Multi-device</span></div>
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
                </div>
              </div>
            {/each}
          {:else}
            <div class="device-card unavailable"><div class="device-head"><div class="device-title"><Icon name="gpu" size={18} /><strong>GPU telemetry</strong></div><div class="device-role">Unavailable</div></div><div class="empty-state compact-empty">{hasToken ? "No GPU devices reported by monitoring." : "Admin token required for detailed GPU monitoring."}</div></div>
          {/if}
          <div class="system-row">
            <div class="device-card unavailable">
              <div class="device-head"><div class="device-title"><Icon name="cpu" size={18} /><strong>CPU</strong></div><div class="device-role">Unavailable</div></div>
              <div class="meter-grid single">
                <div class="meter"><div class="meter-top"><span>Usage</span><span>—</span></div><div class="meter-bar"><span style="width: 0%"></span></div></div>
                <div class="meter"><div class="meter-top"><span>Package temp</span><span>—</span></div><div class="meter-bar"><span style="width: 0%"></span></div></div>
              </div>
            </div>
            <div class="device-card unavailable">
              <div class="device-head"><div class="device-title"><Icon name="database" size={18} /><strong>RAM</strong></div><div class="device-role">System</div></div>
              <div class="meter-grid single">
                <div class="meter"><div class="meter-top"><span>Memory</span><span>—</span></div><div class="meter-bar"><span style="width: 0%"></span></div></div>
                <div class="meter"><div class="meter-top"><span>Commit</span><span>—</span></div><div class="meter-bar"><span style="width: 0%"></span></div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="panel performance-log" aria-label="Performance log">
        <div class="panel-head compact"><h2 class="section-title">Performance Log</h2><span class="mini-pill">Last 5 runs</span></div>
        <div class="perf-summary">
          <div class="perf-stat"><span>Prompt proc.</span><strong>—</strong></div>
          <div class="perf-stat"><span>Decode</span><strong>—</strong></div>
          <div class="perf-stat"><span>Active slots</span><strong>{isRunning ? "1" : "0"} / {formatNumber(llamaArgs?.parallel) === "—" ? "1" : formatNumber(llamaArgs?.parallel)}</strong></div>
        </div>
        <div class="perf-table">
          <div class="perf-row header"><span>Time</span><span>Task</span><span>PP</span><span>Decode</span></div>
          <div class="perf-row empty-row"><span>—</span><span>No performance runs recorded yet</span><span>—</span><span>—</span></div>
          <div class="perf-row empty-row"><span>—</span><span>Awaiting llama-bench history</span><span>—</span><span>—</span></div>
          <div class="perf-row empty-row"><span>—</span><span>Awaiting decode metrics</span><span>—</span><span>—</span></div>
          <div class="perf-row empty-row"><span>—</span><span>Awaiting prompt processing metrics</span><span>—</span><span>—</span></div>
          <div class="perf-row empty-row"><span>—</span><span>Awaiting slot activity metrics</span><span>—</span><span>—</span></div>
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
  .resource-snapshot,
  .performance-log {
    padding: 15px 16px 16px;
  }

  .quick-grid {
    margin-top: 12px;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
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

  .meter-grid.single {
    grid-template-columns: minmax(0, 1fr);
  }

  .system-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 9px;
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

  .perf-summary {
    margin-top: 12px;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .perf-stat {
    min-height: 67px;
    padding: 12px;
    border: 1px solid rgba(132, 153, 188, 0.13);
    border-radius: var(--radius-sm);
    background: rgba(8, 16, 29, 0.54);
  }

  .perf-stat span {
    color: #8997ac;
    font-size: 11px;
    font-weight: 850;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .perf-stat strong {
    display: block;
    margin-top: 8px;
    color: #e2ebf8;
    font-family: var(--font-mono);
    font-size: 17px;
    letter-spacing: -0.03em;
  }

  .perf-table {
    margin-top: 10px;
    border: 1px solid rgba(132, 153, 188, 0.12);
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: rgba(5, 10, 18, 0.44);
  }

  .perf-row {
    display: grid;
    grid-template-columns: 80px 1fr 86px 86px;
    gap: 12px;
    align-items: center;
    min-height: 35px;
    padding: 0 11px;
    border-bottom: 1px solid rgba(132, 153, 188, 0.08);
    color: #a9b6c9;
    font-size: 12px;
  }

  .perf-row:last-child {
    border-bottom: 0;
  }

  .perf-row.header {
    color: #7d8ca2;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: rgba(12, 22, 38, 0.55);
  }

  .perf-row span:not(:nth-child(2)) {
    font-family: var(--font-mono);
  }

  .empty-row {
    color: #78869c;
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
    .meter-grid,
    .system-row,
    .perf-summary {
      grid-template-columns: minmax(0, 1fr);
    }

    .btn.wide {
      grid-column: auto;
    }

    .perf-row {
      grid-template-columns: 70px 1fr;
    }

    .perf-row span:nth-child(3),
    .perf-row span:nth-child(4) {
      display: none;
    }

    .event-line {
      grid-template-columns: 66px 48px 1fr;
    }
  }
</style>
