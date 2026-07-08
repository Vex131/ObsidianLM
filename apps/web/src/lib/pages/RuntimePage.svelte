<script lang="ts">
  import { onMount } from "svelte";
  import type { RuntimeProfile } from "@obsidianlm/shared";
  import PageHeader from "../components/PageHeader.svelte";
  import Icon from "../components/Icon.svelte";
  import { API_ENDPOINTS, fetchJson, readStoredAdminToken, type RuntimeActionResult, type RuntimeState, type StatusResponse } from "../api";
  import { emptyDashboardData, fetchDashboardData, type DashboardData } from "../dashboard/dashboard-data";
  import { formatNumber, formatTimestamp, formatUptime, inferLogTone, normalizeEndpoint } from "../dashboard/dashboard-format";
  import { defaultShellStatus, type ShellStatusSummary } from "../layout/shell-status";

  export let shellStatus: ShellStatusSummary = defaultShellStatus;
  export let status: StatusResponse | null = null;
  export let runtimeState: RuntimeState | null = null;
  export let runtimeWarnings: string[] = [];

  type ReadinessTone = "ok" | "warn" | "error" | "muted";
  type ReadinessItem = { label: string; state: string; tone: ReadinessTone };
  type CommandLine = { kind: "comment" | "executable" | "arg" | "plain"; flag?: string; value?: string };

  let dashboardData: DashboardData = emptyDashboardData;
  let actionPending = false;
  let refreshTimer: number | null = null;
  let endpointCopyLabel = "Copy";
  let commandCopyLabel = "Copy";
  let drawerOpen = false;
  let recoveryOpen = false;
  let profileSearch = "";
  let selectedProfileId: string | null = null;

  $: activeRuntime = dashboardData.runtimeState ?? runtimeState;
  $: activeProfileId = activeRuntime?.activeProfileId ?? status?.activeRuntime?.profileId ?? null;
  $: activeProfile = dashboardData.profiles.find((profile) => profile.id === activeProfileId) ?? null;
  $: runtimeStatus = activeRuntime?.status ?? status?.activeRuntime?.status ?? "stopped";
  $: isRunning = runtimeStatus === "running";
  $: isTransitioning = runtimeStatus === "starting" || runtimeStatus === "stopping";
  $: hasToken = dashboardData.hasToken || Boolean(readStoredAdminToken());
  $: endpoint = normalizeEndpoint(status, activeProfile);
  $: heroTitle = status?.activeRuntime?.profileName ?? activeProfile?.name ?? (activeProfileId ? activeProfileId : "No active profile");
  $: runtimeLabel = shellStatus.runtimeLabel.replace(/^Runtime\s+/i, "Runtime ");
  $: llamaArgs = activeProfile?.llamaArgs;
  $: recentLogs = dashboardData.runtimeLogs.slice().reverse();
  $: latestLog = dashboardData.runtimeLogs.at(-1) ?? null;
  $: readinessItems = buildReadinessItems();
  $: readinessOkCount = readinessItems.filter((item) => item.tone === "ok").length;
  $: commandText = dashboardData.runtimeCommand?.displayCommand?.trim() ?? "";
  $: commandLines = buildCommandLines(dashboardData.runtimeCommand?.executable, dashboardData.runtimeCommand?.args, commandText);
  $: selectedProfile = dashboardData.profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  $: filteredProfiles = filterProfiles(dashboardData.profiles, profileSearch);
  $: activityState = isTransitioning ? runtimeStatus.replace(/^./, (part) => part.toUpperCase()) : isRunning ? "Idle" : "Stopped";
  $: activitySlots = `0 / ${formatNumber(llamaArgs?.parallel) === "—" ? "1" : formatNumber(llamaArgs?.parallel)}`;
  $: lastRequestLabel = latestLog ? formatTimestamp(latestLog.timestamp) : "—";

  async function refreshRuntimeData() {
    dashboardData = await fetchDashboardData(activeProfileId);
    if (!selectedProfileId) {
      selectedProfileId = activeProfileId;
    }
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
    } catch {
      // Action errors are reflected by the refreshed readiness/log panels.
    } finally {
      await refreshRuntimeData();
      actionPending = false;
    }
  }

  async function applySelectedProfile() {
    if (!selectedProfileId || selectedProfileId === activeProfileId || isRunning || isTransitioning || actionPending || !hasToken) {
      drawerOpen = false;
      return;
    }

    actionPending = true;
    try {
      await fetchJson<RuntimeActionResult>(API_ENDPOINTS.profiles.start(selectedProfileId), { method: "POST" });
      drawerOpen = false;
    } catch {
      // Start failures surface through logs and readiness after refresh.
    } finally {
      await refreshRuntimeData();
      actionPending = false;
    }
  }

  async function copyText(value: string, setLabel: (label: string) => void) {
    if (!value || value === "—") {
      setLabel("Unavailable");
    } else {
      try {
        await navigator.clipboard.writeText(value);
        setLabel("Copied");
      } catch {
        setLabel("Copy failed");
      }
    }
    window.setTimeout(() => setLabel("Copy"), 1200);
  }

  function buildReadinessItems(): ReadinessItem[] {
    const warnings = [
      ...(status?.warnings ?? []),
      ...(status?.detection?.warnings ?? []).map((warning) => warning.message),
      ...runtimeWarnings,
      ...dashboardData.runtimeWarnings,
      ...(dashboardData.gpuStatus?.warnings ?? []).map((warning) => warning.message)
    ];
    const warningText = warnings.join(" ").toLowerCase();
    const gpuWarning = warningText.includes("vram") || warningText.includes("gpu") || (dashboardData.gpuStatus?.summary.warningsCount ?? 0) > 0;
    const stale = runtimeStatus === "unknown_previous_runtime";

    return [
      { label: "Backend API reachable", state: status ? "OK" : "Error", tone: status ? "ok" : "error" },
      { label: "Runtime process detected", state: activeRuntime?.pid ? "OK" : isRunning ? "Warn" : "Idle", tone: activeRuntime?.pid ? "ok" : isRunning ? "warn" : "muted" },
      { label: "Endpoint responding", state: isRunning && endpoint !== "—" ? "OK" : "Idle", tone: isRunning && endpoint !== "—" ? "ok" : "muted" },
      { label: "Active profile applied", state: activeProfileId ? "OK" : "Missing", tone: activeProfileId ? "ok" : "muted" },
      { label: "Model file exists", state: activeProfile?.modelPath ? "OK" : "Missing", tone: activeProfile?.modelPath ? "ok" : "muted" },
      { label: "Build path configured", state: activeProfile?.buildPath ? "OK" : "Missing", tone: activeProfile?.buildPath ? "ok" : "muted" },
      { label: "VRAM headroom low", state: gpuWarning ? "Warn" : dashboardData.gpuStatus ? "OK" : "—", tone: gpuWarning ? "warn" : dashboardData.gpuStatus ? "ok" : "muted" },
      { label: "No stale process detected", state: stale ? "Warn" : "OK", tone: stale ? "warn" : "ok" }
    ];
  }

  function filterProfiles(profiles: RuntimeProfile[], search: string): RuntimeProfile[] {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return profiles;
    }
    return profiles.filter((profile) => [profile.name, profile.id, profile.modelPath, profile.buildPath, String(profile.llamaArgs?.ctxSize ?? "")].join(" ").toLowerCase().includes(needle));
  }

  function buildCommandLines(executable: string | undefined, args: string[] | undefined, displayCommand: string): CommandLine[] {
    if (executable || args?.length) {
      const lines: CommandLine[] = [{ kind: "comment", value: "# executable" }, { kind: "executable", value: quoteIfNeeded(executable ?? "llama-server") }];
      const values = args ?? [];
      for (let index = 0; index < values.length; index += 1) {
        const part = values[index];
        if (part.startsWith("-")) {
          const next = values[index + 1];
          if (next && !next.startsWith("-")) {
            lines.push({ kind: "arg", flag: part, value: quoteIfNeeded(next) });
            index += 1;
          } else {
            lines.push({ kind: "arg", flag: part, value: "" });
          }
        } else {
          lines.push({ kind: "plain", value: quoteIfNeeded(part) });
        }
      }
      return lines;
    }
    return displayCommand ? displayCommand.split(/\r?\n/).map((value) => ({ kind: "plain", value })) : [{ kind: "plain", value: "—" }];
  }

  function quoteIfNeeded(value: string): string {
    return /\s/.test(value) && !/^".*"$/.test(value) ? `"${value}"` : value;
  }

  function contextReuseLabel(): string {
    return llamaArgs?.contBatching === undefined ? "—" : llamaArgs.contBatching ? "Enabled" : "Disabled";
  }

  function flashAttentionLabel(): string {
    return llamaArgs?.flashAttention === undefined ? "—" : llamaArgs.flashAttention ? "Enabled" : "Disabled";
  }

  function gpuLayersLabel(): string {
    if (llamaArgs?.gpuLayers === undefined) return "—";
    return llamaArgs.gpuLayers === "all" ? "All layers" : `${llamaArgs.gpuLayers} layers`;
  }

  function batchLabel(): string {
    return `${llamaArgs?.batchSize ? formatNumber(llamaArgs.batchSize) : "—"} / ${llamaArgs?.ubatchSize ? formatNumber(llamaArgs.ubatchSize) : "—"}`;
  }

  function threadsLabel(): string {
    return `${llamaArgs?.threads ? formatNumber(llamaArgs.threads) : "—"} / ${llamaArgs?.threadsBatch ? formatNumber(llamaArgs.threadsBatch) : "—"}`;
  }

  function kvCacheLabel(): string {
    return `${llamaArgs?.cacheTypeK ?? "—"} / ${llamaArgs?.cacheTypeV ?? "—"}`;
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

  function profileMeta(profile: RuntimeProfile): string[] {
    return [
      profile.llamaArgs?.ctxSize ? `${formatNumber(profile.llamaArgs.ctxSize)} ctx` : "ctx —",
      profile.llamaArgs?.gpuLayers === "all" ? "All GPU" : profile.llamaArgs?.gpuLayers !== undefined ? `${profile.llamaArgs.gpuLayers} layers` : "GPU —",
      profile.modelPath?.split(/[\\/]/).pop() ?? "model —"
    ];
  }

  onMount(() => {
    void refreshRuntimeData();
    refreshTimer = window.setInterval(() => void refreshRuntimeData(), 5000);
    return () => {
      if (refreshTimer) window.clearInterval(refreshTimer);
    };
  });
</script>

<main class="page-surface runtime-page" aria-label="Runtime">
  <PageHeader title="Runtime" subtitle="Control the active llama.cpp process, switch profiles safely, and inspect the exact launch state." />

  <div class="runtime-grid">
    <div class="left-column">
      <section class="panel runtime-hero" aria-label="Runtime control hero">
        <div class="hero-main">
          <div class:muted={!isRunning} class="runtime-state-line">{runtimeLabel}</div>
          <div class="hero-title-row">
            <h2 class="runtime-title">{heroTitle}</h2>
            <button class="switch-profile" type="button" on:click={() => { selectedProfileId = activeProfileId; drawerOpen = true; }}>
              <Icon name="search" size={15} />Switch profile
            </button>
          </div>

          <button class="endpoint-copy" type="button" on:click={() => copyText(endpoint, (label) => endpointCopyLabel = label)} aria-label="Copy endpoint">
            <span>{endpoint}</span>
            <span class="copy-state"><Icon name="copy" size={15} /><span>{endpointCopyLabel}</span></span>
          </button>

          <div class="current-activity-strip" aria-label="Current runtime activity">
            <div class="activity-copy">
              <div class="activity-label">Current activity</div>
              <div class="activity-metrics">
                <div class="activity-state">{activityState}</div>
                <div class="activity-metric"><span>Slots</span><strong>{activitySlots}</strong></div>
                <div class="activity-metric"><span>Queue</span><strong>—</strong></div>
                <div class="activity-metric"><span>Last request</span><strong>{lastRequestLabel}</strong></div>
              </div>
            </div>
          </div>
        </div>

        <div class="hero-side">
          <div class="runtime-control">
            <div class="control-title-row"><strong>Runtime controls</strong><span class="mini-pill">{isRunning ? "Healthy" : shellStatus.runtimeLabel.replace(/^Runtime\s+/i, "")}</span></div>
            <div class="control-grid">
              <button class:primary={isRunning} class:disabled={!isRunning || actionPending || isTransitioning || !hasToken} class="btn" type="button" disabled={!isRunning || actionPending || isTransitioning || !hasToken} on:click={() => runRuntimeAction("restart")}><Icon name="refresh" size={16} />Restart</button>
              <button class:danger={isRunning} class:disabled={!isRunning || actionPending || isTransitioning || !hasToken} class="btn" type="button" disabled={!isRunning || actionPending || isTransitioning || !hasToken} on:click={() => runRuntimeAction("stop")}><Icon name="stop" size={16} />Stop</button>
              <button class:primary={!isRunning && Boolean(activeProfileId)} class:disabled={isRunning || actionPending || isTransitioning || !activeProfileId || !hasToken} class="btn wide" type="button" disabled={isRunning || actionPending || isTransitioning || !activeProfileId || !hasToken} on:click={() => runRuntimeAction("start")}><Icon name="play" size={16} />Start runtime</button>
            </div>
            <div class="runtime-micro">
              <span>Runtime</span><span>llama-server</span>
              <span>Last started</span><span>{activeRuntime?.startedAt ? formatTimestamp(activeRuntime.startedAt) : "—"}</span>
              <span>Admin token</span><span>{hasToken ? "Loaded" : "Required"}</span>
              <span>Profile source</span><span title={activeProfile?.id ?? ""}>{activeProfile?.id ?? activeProfileId ?? "—"}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="panel profile-details" aria-label="Set configs">
        <div class="panel-head compact"><h2 class="section-title">Set Configs</h2><span class="mini-pill">From active profile</span></div>
        <div class="profile-grid">
          <div class="detail-group">
            <h3>Launch configuration</h3>
            <div class="kv-list">
              <div class="kv-row"><span>Context size</span><span>{formatNumber(llamaArgs?.ctxSize)}</span></div>
              <div class="kv-row"><span>GPU offload</span><span>{gpuLayersLabel()}</span></div>
              <div class="kv-row"><span>Context reuse</span><span>{contextReuseLabel()}</span></div>
              <div class="kv-row"><span>Parallel slots</span><span>{formatNumber(llamaArgs?.parallel)}</span></div>
              <div class="kv-row"><span>Batch / ubatch</span><span>{batchLabel()}</span></div>
              <div class="kv-row"><span>Threads</span><span>{threadsLabel()}</span></div>
            </div>
          </div>
          <div class="detail-group">
            <h3>Memory &amp; model</h3>
            <div class="kv-list">
              <div class="kv-row"><span>KV cache</span><span>{kvCacheLabel()}</span></div>
              <div class="kv-row"><span>Flash attention</span><span>{flashAttentionLabel()}</span></div>
              <div class="kv-row"><span>Tensor split</span><span>{llamaArgs?.tensorSplit ?? "—"}</span></div>
              <div class="kv-row"><span>Model path</span><span class="path-value" title={activeProfile?.modelPath ?? ""}>{activeProfile?.modelPath ?? "—"}</span></div>
              <div class="kv-row"><span>Build path</span><span class="path-value" title={activeProfile?.buildPath ?? ""}>{activeProfile?.buildPath ?? "—"}</span></div>
              <div class="kv-row"><span>Profile file</span><span>{activeProfile?.id ?? activeProfileId ?? "—"}</span></div>
            </div>
          </div>
        </div>
      </section>

      <section class="panel events-card" aria-label="Recent runtime logs">
        <div class="panel-head compact"><h2 class="section-title">Recent Runtime Logs</h2><span class="mini-pill">{hasToken ? "Live tail" : "Token required"}</span></div>
        <div class="event-stream tall">
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
      <section class="panel readiness-card" aria-label="Readiness and warnings">
        <div class="panel-head compact"><h2 class="section-title">Readiness &amp; Warnings</h2><span class="mini-pill">{readinessOkCount}/{readinessItems.length} OK</span></div>
        <div class="readiness-list">
          {#each readinessItems as item}
            <div class:warn={item.tone === "warn"} class:error={item.tone === "error"} class:muted={item.tone === "muted"} class="readiness-item">
              {#if item.tone === "warn" || item.tone === "error"}<span class={`dot ${item.tone}`}></span>{/if}
              {item.label}<strong>{item.state}</strong>
            </div>
          {/each}
        </div>
        <button class="recovery-toggle" type="button" aria-expanded={recoveryOpen} on:click={() => recoveryOpen = !recoveryOpen}><span>Recovery actions</span><Icon name="chevron-up" size={16} /></button>
        <div class:open={recoveryOpen} class="recovery-panel">
          <div class="recovery-action"><span>Stale process cleanup. Use only when the server appears stopped but the port is still occupied.</span><button type="button" disabled>Clean</button></div>
          <div class="recovery-action"><span>Force stop runtime process. Use the existing Stop control first.</span><button type="button" disabled>Force</button></div>
          <div class="recovery-action"><span>Run preflight validation before starting the selected profile.</span><button type="button" disabled>Check</button></div>
        </div>
      </section>

      <section class="panel command-card" aria-label="Launch command">
        <div class="panel-head compact"><h2 class="section-title">Launch Command</h2></div>
        <div class="command-box">
          <div class="command-toolbar">
            <span><Icon name="terminal" size={16} />Generated from active profile</span>
            <button type="button" on:click={() => copyText(commandText, (label) => commandCopyLabel = label)} disabled={!commandText}><Icon name="copy" size={14} />{commandCopyLabel}</button>
          </div>
          <pre class="command-pre">{#each commandLines as line}{#if line.kind === "comment"}<span class="cmd-comment">{line.value}</span>{:else if line.kind === "executable"}<span class="cmd-path">{line.value}</span>{:else if line.kind === "arg"}<span class="cmd-flag">{line.flag}</span>{#if line.value} <span class="cmd-value">{line.value}</span>{/if}{:else}<span>{line.value}</span>{/if}{"\n"}{/each}</pre>
        </div>
      </section>
    </div>
  </div>
</main>

{#if drawerOpen}
  <button class="profile-drawer-backdrop open" type="button" aria-label="Close profile picker" on:click={() => drawerOpen = false}></button>
{/if}
{#if drawerOpen}
<aside class:open={drawerOpen} class="profile-drawer" aria-label="Switch profile drawer">
  <div class="drawer-head">
    <div class="drawer-title"><strong>Switch Profile</strong><span>Search profiles without crowding the Runtime hero.</span></div>
    <button class="drawer-close" type="button" aria-label="Close profile picker" on:click={() => drawerOpen = false}><Icon name="x" size={18} /></button>
  </div>
  <div class="drawer-search-wrap"><input class="drawer-search" bind:value={profileSearch} type="search" placeholder="Search by name, model, context, or build..." /></div>
  <div class="profile-list">
    {#if filteredProfiles.length > 0}
      {#each filteredProfiles as profile}
        <button class:active={profile.id === selectedProfileId} class="profile-option" type="button" on:click={() => selectedProfileId = profile.id}>
          <span class="profile-option-top"><strong>{profile.name}</strong><span class="mini-pill">{profile.id === activeProfileId ? "Active" : "Ready"}</span></span>
          <span class="profile-option-meta">{#each profileMeta(profile) as meta}<span class="tag">{meta}</span>{/each}</span>
        </button>
      {/each}
    {:else}
      <div class="empty-state">{hasToken ? "No profiles match this search." : "Load an admin token to list profiles."}</div>
    {/if}
  </div>
  <div class="drawer-actions">
    <span class="drawer-note">{isRunning ? "Stop the runtime before applying a different profile safely." : selectedProfile ? `Selected: ${selectedProfile.name}` : "Choose a profile to start it."}</span>
    <button class:primary={Boolean(selectedProfileId)} class="btn" type="button" disabled={!selectedProfileId || isRunning || isTransitioning || actionPending || !hasToken} on:click={applySelectedProfile}>Apply profile</button>
  </div>
</aside>
{/if}
