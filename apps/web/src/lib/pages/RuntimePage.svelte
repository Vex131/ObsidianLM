<script lang="ts">
  import { onMount } from "svelte";
  import type { ConfiguredModelDetails, RouterRuntimeResponse, RuntimeLogEntry } from "@obsidianlm/shared";
  import PageHeader from "../components/PageHeader.svelte";
  import Icon from "../components/Icon.svelte";
  import { API_ENDPOINTS, fetchJson, readStoredAdminToken, type RuntimeActionResult } from "../api";
  import { emptyDashboardData, fetchDashboardData, type DashboardData } from "../dashboard/dashboard-data";
  import { formatNumber, formatTimestamp, inferLogTone } from "../dashboard/dashboard-format";
  import { configuredModelActionLabel, configuredModelActionMessage, runConfiguredModelAction } from "../components/configured-model-runtime-action";

  export let routerRuntime: RouterRuntimeResponse | null = null;

  type ReadinessTone = "ok" | "warn" | "error" | "muted";
  type ReadinessItem = { label: string; state: string; tone: ReadinessTone };

  let dashboardData: DashboardData = emptyDashboardData;
  let actionPending = false;
  let actionMessage = "";
  let refreshTimer: number | null = null;
  let refreshGeneration = 0;
  let endpointCopyLabel = "Copy";
  let commandCopyLabel = "Copy";
  let drawerOpen = false;
  let modelSearch = "";
  let selectedModelId: string | null = null;

  $: runtime = dashboardData.runtime ?? routerRuntime;
  $: router = runtime?.routerState ?? null;
  $: activeBuild = dashboardData.builds.find((build) => build.id === router?.activeBuildId) ?? null;
  $: routerStatus = router?.status ?? "stopped";
  $: isRunning = routerStatus === "running";
  $: isTransitioning = routerStatus === "starting" || routerStatus === "stopping";
  $: hasToken = dashboardData.hasToken || Boolean(readStoredAdminToken());
  $: loadedStates = router?.configuredModelStates.filter((entry) => entry.state === "loaded") ?? [];
  $: activeLoadStates = router?.configuredModelStates.filter((entry) => entry.state === "loaded" || entry.state === "loading") ?? [];
  $: routerPolicyWarning = activeLoadStates.length > 1 ? `Router policy permits one loaded or loading model; ${activeLoadStates.length} are reported.` : "";
  $: loadedModels = loadedStates.map((entry) => dashboardData.configuredModels.find((model) => model.id === entry.configuredModelId)).filter((model): model is ConfiguredModelDetails => Boolean(model));
  $: loadedModelLabels = loadedStates.map((entry) => dashboardData.configuredModels.find((model) => model.id === entry.configuredModelId)?.displayName ?? entry.configuredModelId);
  $: configuredStateCount = router?.configuredModelStates.length ?? 0;
  $: endpointPort = router?.port ?? dashboardData.readiness?.managedPort.port ?? null;
  $: endpoint = endpointPort ? `http://localhost:${endpointPort}/v1${router?.port ? "" : " (stopped)"}` : "—";
  $: heroTitle = routerStatus === "stopped" ? "Managed router stopped" : routerStatus === "failed" ? "Managed router failed" : routerStatus === "unknown_previous_runtime" ? "Managed router ownership uncertain" : activeBuild?.displayName ?? router?.activeBuildId ?? "Managed router";
  $: heroState = routerStatus.replace(/_/g, " ");
  $: recentLogs = dashboardData.runtimeLogs.slice().reverse();
  $: latestLog = dashboardData.runtimeLogs.at(-1) ?? null;
  $: readinessItems = buildReadinessItems();
  $: readinessOkCount = readinessItems.filter((item) => item.tone === "ok").length;
  $: commandText = dashboardData.runtimeCommand?.displayCommand?.trim() ?? "";
  $: filteredModels = filterModels(dashboardData.configuredModels, modelSearch);
  $: selectedModel = dashboardData.configuredModels.find((model) => model.id === selectedModelId) ?? null;
  $: provenChildCount = dashboardData.processes?.processes.filter((process) => process.role === "managed_router_child" && process.ownership === "proven").length ?? 0;
  $: loadingModels = router?.configuredModelStates.filter((entry) => entry.state === "loading").map((entry) => dashboardData.configuredModels.find((model) => model.id === entry.configuredModelId)).filter((model): model is ConfiguredModelDetails => Boolean(model)) ?? [];
  $: activityState = routerStatus === "starting" ? "Starting router" : routerStatus === "stopping" ? "Stopping router" : routerStatus === "failed" ? "Router failed" : routerStatus === "stopped" ? "Stopped" : loadingModels.length === 1 ? `Loading ${loadingModels[0].displayName}` : loadedStates.length === 1 ? `Loaded ${loadedModelLabels[0]}` : loadedStates.length > 1 ? `${loadedStates.length} models loaded · policy expects 1` : "Router idle";

  async function refreshRuntimeData() {
    const generation = ++refreshGeneration;
    try {
      const data = await fetchDashboardData();
      if (generation === refreshGeneration) dashboardData = data;
    } catch (cause) {
      if (generation === refreshGeneration) actionMessage = cause instanceof Error ? cause.message : "Could not refresh router runtime data.";
    }
  }

  async function runRouterAction(action: "restart" | "stop") {
    if (actionPending || !hasToken) return;
    actionPending = true;
    actionMessage = "";
    try {
      const result = await fetchJson<RuntimeActionResult>(action === "restart" ? API_ENDPOINTS.runtime.restart : API_ENDPOINTS.runtime.stop, { method: "POST" });
      actionMessage = result.message;
    } catch (cause) {
      actionMessage = configuredModelActionMessage(cause);
    } finally {
      await refreshRuntimeData();
      actionPending = false;
    }
  }

  async function runSelectedModel() {
    if (!selectedModel || actionPending || !hasToken || !modelAvailable(selectedModel) || modelRouterState(selectedModel) === "loaded") return;
    actionPending = true;
    actionMessage = "";
    try {
       const completed = await runConfiguredModelAction(selectedModel, runtime);
       if (!completed) return;
      actionMessage = `${selectedModel.displayName} requested.`;
      drawerOpen = false;
    } catch (cause) {
      actionMessage = configuredModelActionMessage(cause);
    } finally {
      await refreshRuntimeData();
      actionPending = false;
    }
  }

  async function copyText(value: string, setLabel: (label: string) => void) {
    if (!value || value === "—") setLabel("Unavailable");
    else {
      try { await navigator.clipboard.writeText(value); setLabel("Copied"); }
      catch { setLabel("Copy failed"); }
    }
    window.setTimeout(() => setLabel("Copy"), 1200);
  }

  function buildReadinessItems(): ReadinessItem[] {
    const artifact = router?.generatedArtifact;
    const managedPort = dashboardData.readiness?.managedPort;
    const gpu = dashboardData.gpuStatus;
    const processAvailable = dashboardData.processes?.available;
    return [
      { label: "Router ownership", state: router ? `${router.startedByObsidianLM ? "Managed" : "Unmanaged"} / ${router.ownershipEvidence}` : "Unavailable", tone: router?.ownershipEvidence === "current_process_child" ? "ok" : router ? "warn" : "muted" },
      { label: "Router health", state: router?.health.state ?? "Unavailable", tone: router?.health.state === "healthy" ? "ok" : router?.health.state === "unhealthy" || router?.health.state === "failed" ? "error" : "muted" },
      { label: "Build eligibility", state: activeBuild?.managedInferenceEligibility ?? "Unavailable", tone: activeBuild?.managedInferenceEligibility === "eligible" ? "ok" : activeBuild ? "warn" : "muted" },
      { label: "Router preset", state: artifact ? `${artifact.freshness} / ${artifact.validationState}` : "Unavailable", tone: artifact?.validationState === "valid" && artifact.freshness === "current" ? "ok" : artifact?.validationState === "invalid" || artifact?.validationState === "failed" ? "error" : "muted" },
      { label: "Catalog", state: router?.catalog ? `${router.catalog.reconciliationState} (${router.catalog.entries.length})` : "Unavailable", tone: router?.catalog?.reconciliationState === "reconciled" ? "ok" : router?.catalog ? "warn" : "muted" },
      { label: "Managed port", state: managedPort ? `${managedPort.port}: ${managedPort.inUse ? "in use" : "free"}` : "Unavailable", tone: managedPort?.conflict ? "error" : managedPort ? "ok" : "muted" },
      { label: "GPU", state: gpu ? `${gpu.summary.gpuCount} detected${gpu.summary.warningsCount ? ` / ${gpu.summary.warningsCount} warnings` : ""}` : "Unavailable", tone: gpu?.summary.warningsCount ? "warn" : gpu ? "ok" : "muted" },
      { label: "Process detection", state: processAvailable === false ? "Unavailable" : dashboardData.processes ? `${dashboardData.processes.processes.length} observed` : "Unavailable", tone: processAvailable === false || !dashboardData.processes ? "muted" : "ok" },
      { label: "Previous runtime", state: router?.previousRuntimeUncertainty ?? "No uncertainty reported", tone: router?.previousRuntimeUncertainty ? "warn" : "ok" }
    ];
  }

  function filterModels(models: ConfiguredModelDetails[], search: string) {
    const needle = search.trim().toLowerCase();
    if (!needle) return models;
    return models.filter((model) => [model.displayName, model.routerAlias, model.build?.displayName, model.artifact?.resource.locator, model.llamaArgs?.ctxSize].filter(Boolean).join(" ").toLowerCase().includes(needle));
  }

  function modelRouterState(model: ConfiguredModelDetails) {
    if (router?.activeBuildId !== model.buildId) return router ? "other build" : "unavailable";
    return router.configuredModelStates.find((entry) => entry.configuredModelId === model.id)?.state ?? "unloaded";
  }

  function modelAvailable(model: ConfiguredModelDetails) {
    return model.enabled && model.validation.status !== "invalid" && model.validation.references.artifact === "available" && model.validation.references.build === "available" && model.validation.managedInferenceEligibility !== "ineligible" && router?.status !== "failed" && router?.status !== "unknown_previous_runtime";
  }

  function modelKind(model: ConfiguredModelDetails) {
    return model.projector ? `Vision · explicit projector ${model.projector.resource.locator}` : "Text";
  }

  function logLabel(log: RuntimeLogEntry) {
    if (inferLogTone(log.message) === "red" || log.source === "stderr") return "ERR";
    if (inferLogTone(log.message) === "amber") return "WARN";
    if (log.origin === "router") return "ROUTER";
    if (log.origin === "router_child" || log.configuredModelId || log.routerAlias) return "MODEL";
    return "SYS";
  }

  function logToneClass(log: RuntimeLogEntry) {
    const label = logLabel(log);
    return label === "ERR" ? "error" : label === "WARN" ? "warn" : label === "ROUTER" || label === "MODEL" ? "run" : "info";
  }

  function logModel(log: RuntimeLogEntry) {
    const model = dashboardData.configuredModels.find((entry) => entry.id === log.configuredModelId);
    if (model) return `${model.displayName} / ${model.routerAlias}`;
    if (log.routerAlias) return log.routerAlias;
    return log.origin === "router_child_candidate" ? "candidate child" : log.origin === "unknown" ? "unknown origin" : "";
  }

  onMount(() => {
    void refreshRuntimeData();
    refreshTimer = window.setInterval(() => void refreshRuntimeData(), 5000);
    return () => { if (refreshTimer) window.clearInterval(refreshTimer); };
  });
</script>

<main class="page-surface runtime-page" aria-label="Runtime">
  <PageHeader title="Runtime" subtitle="Inspect and control the managed router, its configured models, and its generated launch state." />
  <div class="runtime-grid">
    <div class="left-column">
      <section class="panel runtime-hero" aria-label="Router control hero">
        <div class="hero-main">
          <div class:muted={!isRunning} class="runtime-state-line">Router {heroState}</div>
          <div class="hero-title-row">
            <h2 class="runtime-title">{heroTitle}</h2>
             <button class="switch-profile" type="button" on:click={() => { selectedModelId = loadedModels.length === 1 ? loadedModels[0].id : null; drawerOpen = true; }}><Icon name="search" size={15} />{isRunning ? "Switch model" : "Select model to start"}</button>
          </div>
          <button class="endpoint-copy" type="button" on:click={() => copyText(endpoint, (label) => endpointCopyLabel = label)} aria-label="Copy router endpoint"><span>{endpoint}</span><span class="copy-state"><Icon name="copy" size={15} /><span>{endpointCopyLabel}</span></span></button>
          <div class="current-activity-strip" aria-label="Current router activity">
            <div class="activity-copy"><div class="activity-label">Grounded activity</div><div class="activity-metrics">
               <div class="activity-state">{activityState}</div><div class="activity-metric"><span>Loaded</span><strong>{loadedStates.length} / policy 1</strong></div><div class="activity-metric"><span>Catalog</span><strong>{router?.catalog?.entries.length ?? "—"} models</strong></div><div class="activity-metric"><span>Health</span><strong>{router?.health.state ?? "—"}</strong></div><div class="activity-metric"><span>Last event</span><strong>{latestLog ? formatTimestamp(latestLog.timestamp) : "—"}</strong></div>
            </div></div>
          </div>
        </div>
        <div class="hero-side"><div class="runtime-control">
          <div class="control-title-row"><strong>Router controls</strong><span class="mini-pill">{routerStatus}</span></div>
          <div class="control-grid">
            <button class:primary={isRunning} class:disabled={!isRunning || actionPending || isTransitioning || !hasToken} class="btn" type="button" disabled={!isRunning || actionPending || isTransitioning || !hasToken} on:click={() => runRouterAction("restart")}><Icon name="refresh" size={16} />Restart router</button>
            <button class:danger={isRunning} class:disabled={!isRunning || actionPending || isTransitioning || !hasToken} class="btn" type="button" disabled={!isRunning || actionPending || isTransitioning || !hasToken} on:click={() => runRouterAction("stop")}><Icon name="stop" size={16} />Stop router</button>
          </div>
          <div class="runtime-micro"><span>PID</span><span>{router?.pid ?? "—"}</span><span>Build</span><span>{activeBuild?.displayName ?? router?.activeBuildId ?? "—"}</span><span>Managed proven children</span><span>{provenChildCount}</span><span>Last started</span><span>{router?.startedAt ? formatTimestamp(router.startedAt) : "—"}</span></div>
          {#if actionMessage}<p class="warning" aria-live="polite">{actionMessage}</p>{/if}
        </div></div>
      </section>

      <section class="panel profile-details" aria-label="Active router configuration">
        <div class="panel-head compact"><h2 class="section-title">Active Router Configuration</h2><span class="mini-pill">Router native</span></div>
        {#if routerPolicyWarning}<p class="warning" aria-live="polite">{routerPolicyWarning}</p>{/if}
        <div class="profile-grid">
          <div class="detail-group"><h3>Router</h3><div class="kv-list">
            <div class="kv-row"><span>Build eligibility</span><span>{activeBuild?.managedInferenceEligibility ?? "—"}</span></div><div class="kv-row"><span>Models max</span><span>1</span></div><div class="kv-row"><span>Autoload</span><span>Enabled</span></div><div class="kv-row"><span>Preset source revision</span><span>{router?.generatedArtifact?.sourceRevision ?? "—"}</span></div><div class="kv-row"><span>Preset freshness</span><span>{router?.generatedArtifact?.freshness ?? "—"}</span></div><div class="kv-row"><span>Preset validation</span><span>{router?.generatedArtifact?.validationState ?? "—"}</span></div><div class="kv-row"><span>Configured states</span><span>{configuredStateCount}</span></div><div class="kv-row"><span>Endpoint</span><span class="path-value">{endpoint}</span></div>
          </div></div>
          <div class="detail-group"><h3>Loaded Model Config</h3>
             {#if loadedStates.length === 1 && loadedModels.length === 1}{#each loadedModels as model}<div class="kv-list">
              <div class="kv-row"><span>Model</span><span>{model.displayName}</span></div><div class="kv-row"><span>Mode</span><span>{modelKind(model)}</span></div><div class="kv-row"><span>Context</span><span>{formatNumber(model.llamaArgs?.ctxSize)}</span></div><div class="kv-row"><span>GPU offload</span><span>{model.llamaArgs?.gpuLayers === "all" ? "All layers" : model.llamaArgs?.gpuLayers ?? "—"}</span></div><div class="kv-row"><span>KV cache</span><span>{model.llamaArgs?.cacheTypeK ?? "—"} / {model.llamaArgs?.cacheTypeV ?? "—"}</span></div><div class="kv-row"><span>Batch / ubatch</span><span>{formatNumber(model.llamaArgs?.batchSize)} / {formatNumber(model.llamaArgs?.ubatchSize)}</span></div><div class="kv-row"><span>Tensor split</span><span>{model.llamaArgs?.tensorSplit ?? "—"}</span></div>
             </div>{/each}{:else if loadedStates.length === 1}<p class="warning">{loadedModelLabels[0]} is reported loaded; Configured Model details are unavailable.</p>{:else if loadedStates.length === 0}<p class="empty-state">No configured model is loaded.</p>{:else}<p class="warning">Multiple configured models are reported loaded ({loadedStates.length}); router policy allows one.</p>{#each loadedModelLabels as label}<p>{label}</p>{/each}{/if}
          </div>
        </div>
      </section>

      <section class="panel events-card" aria-label="Recent runtime logs"><div class="panel-head compact"><h2 class="section-title">Recent Runtime Logs</h2><a href="#logs">Open full Logs</a></div><div class="event-stream tall">
        {#if recentLogs.length > 0}{#each recentLogs as log}<div class="event-line"><span class="event-time">{formatTimestamp(log.timestamp)}</span><span class={`event-type ${logToneClass(log)}`}>{logLabel(log)}</span>{#if logModel(log)}<span class="tag">{logModel(log)}</span>{/if}<span class="event-message" title={log.message}>{log.message}</span></div>{/each}{:else}<div class="empty-state">{hasToken ? "No runtime log entries recorded yet." : "Load an admin token to show protected runtime logs."}</div>{/if}
      </div></section>
    </div>
    <div class="right-column">
      <section class="panel readiness-card" aria-label="Readiness and warnings"><div class="panel-head compact"><h2 class="section-title">Readiness &amp; Warnings</h2><span class="mini-pill">{readinessOkCount}/{readinessItems.length} OK</span></div><div class="readiness-list">{#each readinessItems as item}<div class:warn={item.tone === "warn"} class:error={item.tone === "error"} class:muted={item.tone === "muted"} class="readiness-item">{#if item.tone === "warn" || item.tone === "error"}<span class={`dot ${item.tone}`}></span>{/if}{item.label}<strong>{item.state}</strong></div>{/each}</div><div class="safe-links"><a href="#telemetry">Open Telemetry</a><a href="#logs">Open Logs</a><a href="#system">Validate setup</a></div></section>
      <section class="panel command-card" aria-label="Launch command"><div class="panel-head compact"><h2 class="section-title">Launch Command</h2></div><div class="command-box"><div class="command-toolbar"><span><Icon name="terminal" size={16} />Actual managed router launch</span><button type="button" on:click={() => copyText(commandText, (label) => commandCopyLabel = label)} disabled={!commandText}><Icon name="copy" size={14} />{commandCopyLabel}</button></div><pre class="command-pre">{commandText || "No active router command."}</pre></div></section>
    </div>
  </div>
</main>

{#if drawerOpen}
  <button class="profile-drawer-backdrop open" type="button" aria-label="Close configured model picker" on:click={() => drawerOpen = false}></button>
  <aside class:open={drawerOpen} class="profile-drawer" aria-label="Configured model drawer">
    <div class="drawer-head"><div class="drawer-title"><strong>{isRunning ? "Switch Configured Model" : "Select Configured Model"}</strong><span>Same Build switches model; a different Build restarts the router.</span></div><button class="drawer-close" type="button" aria-label="Close configured model picker" on:click={() => drawerOpen = false}><Icon name="x" size={18} /></button></div>
    <div class="drawer-search-wrap"><input class="drawer-search" bind:value={modelSearch} type="search" placeholder="Search display name, alias, Build, artifact, or context..." /></div>
    <div class="profile-list">
      {#if filteredModels.length > 0}{#each filteredModels as model}<button class:active={model.id === selectedModelId} class="profile-option" type="button" disabled={!modelAvailable(model)} on:click={() => selectedModelId = model.id}><span class="profile-option-top"><strong>{model.displayName}</strong><span class="mini-pill">{modelRouterState(model)}</span></span><span class="profile-option-meta"><span class="tag">{model.build?.displayName ?? "Build unavailable"}</span><span class="tag">{modelKind(model)}</span><span class="tag">{model.enabled ? "enabled" : "disabled"}</span><span class="tag">{formatNumber(model.llamaArgs?.ctxSize)} ctx</span></span><small class:warning={!modelAvailable(model)}>validation {model.validation.status}; artifact {model.validation.references.artifact}; build {model.validation.references.build}</small></button>{/each}{:else}<div class="empty-state">{hasToken ? "No configured models match this search." : "Load an admin token to list configured models."}</div>{/if}
    </div>
    <div class="drawer-actions"><span class="drawer-note">{selectedModel ? `${selectedModel.displayName}: ${configuredModelActionLabel(selectedModel, dashboardData.runtime)}` : "Choose a configured model."}</span><button class:primary={Boolean(selectedModel)} class="btn" type="button" disabled={!selectedModel || !modelAvailable(selectedModel) || modelRouterState(selectedModel) === "loaded" || actionPending || !hasToken} on:click={runSelectedModel}>{actionPending ? "Working…" : selectedModel ? configuredModelActionLabel(selectedModel, dashboardData.runtime) : "Select model"}</button></div>
  </aside>
{/if}
