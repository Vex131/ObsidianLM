<script lang="ts">
  import type { StatusResponse } from "@obsidianlm/shared";
  import MetricRow from "./lib/components/MetricRow.svelte";
  import Panel from "./lib/components/Panel.svelte";
  import StatusPill from "./lib/components/StatusPill.svelte";
  import TerminalBlock from "./lib/components/TerminalBlock.svelte";
  import ToolbarButton from "./lib/components/ToolbarButton.svelte";

  const navItems = ["Overview", "Runtime", "Profiles", "Models", "Builds", "Logs", "Settings"];

  let status = $state<StatusResponse | null>(null);
  let errorMessage = $state<string | null>(null);
  let isLoading = $state(true);

  const runtimeControlsPlanned = "Runtime controls are planned for the next phase and are not wired to backend actions yet.";

  async function loadStatus(): Promise<void> {
    isLoading = true;
    errorMessage = null;

    try {
      const response = await fetch("/api/status");

      if (!response.ok) {
        throw new Error(`Status request failed with ${response.status}`);
      }

      status = (await response.json()) as StatusResponse;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to load service status.";
      status = null;
    } finally {
      isLoading = false;
    }
  }

  const serviceState = $derived(errorMessage ? "offline" : status ? "online" : isLoading ? "unknown" : "warning");
  const serviceLabel = $derived(errorMessage ? "Service unreachable" : status ? "Service online" : isLoading ? "Checking service" : "Status unknown");
  const runtimeState = $derived(status?.activeRuntime ? "running" : "stopped");
  const runtimeLabel = $derived(status?.activeRuntime ? "Runtime active" : "No managed runtime active");
  const activeRuntimeTitle = $derived(status?.activeRuntime ? "Managed runtime" : "No runtime active yet");
  const warnings = $derived(status?.warnings ?? []);
  const commandPreview = $derived([
    "# Command preview will appear here after a runtime profile is configured.",
    "# ObsidianLM will show the llama-server.exe launch command before it starts a managed process."
  ]);
  const logPreview = $derived([
    "No runtime logs yet.",
    "Start a managed runtime in a future phase to stream llama.cpp output here."
  ]);

  $effect(() => {
    void loadStatus();
  });
</script>

<main class="app-shell">
  <aside class="sidebar" aria-label="Primary navigation">
    <div class="brand-block">
      <div class="brand-mark" aria-hidden="true">OLM</div>
      <div>
        <strong>ObsidianLM</strong>
        <span>Local runtime control</span>
      </div>
    </div>

    <nav class="nav-list">
      {#each navItems as item}
        {#if item === "Overview"}
          <a class="nav-item active" href="/" aria-current="page">
            <span class="nav-dot" aria-hidden="true"></span>
            {item}
          </a>
        {:else}
          <span class="nav-item disabled" title="Coming soon">
            <span class="nav-dot muted" aria-hidden="true"></span>
            {item}
            <small>soon</small>
          </span>
        {/if}
      {/each}
    </nav>
  </aside>

  <section class="workspace">
    <header class="topbar">
      <div>
        <p class="eyebrow">Runtime cockpit</p>
        <h1>ObsidianLM</h1>
        <p class="subtitle">A lightweight local control plane for llama.cpp and future runtime adapters.</p>
      </div>

      <div class="topbar-status" aria-live="polite">
        <StatusPill tone={serviceState} label={serviceLabel} />
        <ToolbarButton variant="secondary" onclick={loadStatus} disabled={isLoading} title="Refresh service status">
          {isLoading ? "Checking..." : "Refresh"}
        </ToolbarButton>
      </div>
    </header>

    {#if errorMessage}
      <Panel tone="danger" eyebrow="Connection" title="Service API is unreachable" class="offline-panel">
        <p>
          The web UI could not reach <code>/api/status</code>. Start the ObsidianLM service or check the development proxy, then refresh.
        </p>
        <p class="error-detail">{errorMessage}</p>
      </Panel>
    {/if}

    <section class="dashboard-grid" aria-live="polite">
      <Panel tone={serviceState === "online" ? "live" : errorMessage ? "danger" : "warning"} eyebrow="Runtime status" title={runtimeLabel} class="runtime-status-card">
        <div class="runtime-summary">
          <div class={`runtime-orb runtime-${runtimeState}`} aria-hidden="true"></div>
          <div>
            <StatusPill tone={runtimeState === "running" ? "online" : "offline"} label={runtimeState === "running" ? "Running" : "Stopped"} />
            <p>
              {errorMessage
                ? "Service is unreachable; runtime state cannot be verified."
                : status?.activeRuntime
                  ? "A managed runtime is reported by the service."
                  : "The service is reachable, but no llama.cpp runtime is currently managed by ObsidianLM."}
            </p>
          </div>
        </div>

        <div class="metric-grid compact">
          <MetricRow label="Service API" value={status ? status.service : errorMessage ? "offline" : "checking"} />
          <MetricRow label="App" value={status?.app ?? "ObsidianLM"} />
          <MetricRow label="Version" value={status?.version ?? "--"} />
          <MetricRow label="Runtime type" value="llama.cpp" />
        </div>
      </Panel>

      <Panel eyebrow="Ports" title="Local endpoints" class="ports-card">
        <MetricRow label="ObsidianLM UI/API" value={status?.uiPort ? `:${status.uiPort}` : "--"} />
        <MetricRow label="Managed llama.cpp" value={status?.managedLlamaPort ? `:${status.managedLlamaPort}` : "--"} />
        <MetricRow label="Runtime endpoint" value={status?.activeRuntime ? `bound on :${status.managedLlamaPort}/v1` : "Reserved, not active"} muted={!status?.activeRuntime} />
      </Panel>

      <Panel eyebrow="Active runtime" title={activeRuntimeTitle} class="active-runtime-card">
        <p class="panel-copy">Runtime management is not implemented in this phase. These fields reserve the shape of the operator console without pretending controls are live.</p>
        <div class="metric-grid">
          <MetricRow label="Model" value="Not selected" muted />
          <MetricRow label="llama.cpp build" value="Not selected" muted />
          <MetricRow label="Profile" value="None" muted />
          <MetricRow label="Context" value="--" muted />
          <MetricRow label="GPUs" value="--" muted />
          <MetricRow label="Endpoint" value="Not bound" muted />
        </div>
      </Panel>

      <Panel eyebrow="Controls" title="Runtime actions" class="controls-card">
        <div class="control-stack" aria-describedby="runtime-controls-help">
          <ToolbarButton variant="success" disabled title={runtimeControlsPlanned}>Start runtime</ToolbarButton>
          <ToolbarButton variant="danger" disabled title={runtimeControlsPlanned}>Stop runtime</ToolbarButton>
          <ToolbarButton variant="secondary" disabled title={runtimeControlsPlanned}>Restart</ToolbarButton>
        </div>
        <p id="runtime-controls-help" class="helper-text">{runtimeControlsPlanned}</p>
      </Panel>

      <Panel tone="code" eyebrow="Command preview" title="Launch command" class="command-card">
        <TerminalBlock label="llama-server.exe" lines={commandPreview} />
      </Panel>

      <Panel tone={warnings.length ? "warning" : "default"} eyebrow="Safety" title="Warnings">
        {#if warnings.length}
          <ul class="warning-list">
            {#each warnings as warning}
              <li>{warning}</li>
            {/each}
          </ul>
        {:else}
          <p class="empty-copy">No warnings reported by the service. ObsidianLM will not stop unknown processes automatically.</p>
        {/if}
      </Panel>

      <Panel tone="code" eyebrow="Logs preview" title="Runtime output" class="logs-card">
        <TerminalBlock label="runtime.log" lines={logPreview} empty />
      </Panel>
    </section>
  </section>
</main>
