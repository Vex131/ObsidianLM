<script lang="ts">
  import type { CommandSpec, RuntimeActionResult, RuntimeLogEntry, RuntimeProfile, RuntimeState, StatusResponse } from "@obsidianlm/shared";
  import MetricRow from "./lib/components/MetricRow.svelte";
  import Panel from "./lib/components/Panel.svelte";
  import StatusPill from "./lib/components/StatusPill.svelte";
  import TerminalBlock from "./lib/components/TerminalBlock.svelte";
  import ToolbarButton from "./lib/components/ToolbarButton.svelte";

  interface ProfilesResponse {
    profiles: RuntimeProfile[];
  }

  interface RuntimeResponse {
    state: RuntimeState;
    warnings: string[];
  }

  interface ValidationResponse {
    valid: boolean;
    errors: string[];
    warnings: string[];
  }

  const navItems = ["Overview", "Runtime", "Profiles", "Logs", "Settings"];

  let status = $state<StatusResponse | null>(null);
  let runtime = $state<RuntimeState | null>(null);
  let profiles = $state<RuntimeProfile[]>([]);
  let selectedProfileId = $state("");
  let command = $state<CommandSpec | null>(null);
  let logs = $state<RuntimeLogEntry[]>([]);
  let errorMessage = $state<string | null>(null);
  let actionMessage = $state<string | null>(null);
  let validation = $state<ValidationResponse | null>(null);
  let isLoading = $state(true);
  let pendingAction = $state<string | null>(null);
  let eventSource = $state<EventSource | null>(null);

  const selectedProfile = $derived(profiles.find((profile) => profile.id === selectedProfileId) ?? null);
  const serviceState = $derived(errorMessage ? "offline" : status ? "online" : isLoading ? "unknown" : "warning");
  const serviceLabel = $derived(errorMessage ? "Service unreachable" : status ? "Service online" : isLoading ? "Checking service" : "Status unknown");
  const runtimeStatus = $derived(runtime?.status ?? status?.activeRuntime?.status ?? "stopped");
  const runtimeTone = $derived(runtimeStatus === "running" ? "online" : runtimeStatus === "failed" ? "danger" : runtimeStatus === "starting" || runtimeStatus === "stopping" ? "warning" : "offline");
  const warnings = $derived([...(status?.warnings ?? []), ...(validation?.warnings ?? [])]);
  const apiUrl = $derived(status?.activeRuntime?.apiUrl ?? (selectedProfile ? `http://localhost:${selectedProfile.port}/v1` : `http://localhost:${status?.managedLlamaPort ?? 8085}/v1`));
  const commandLines = $derived(command ? [command.displayCommand] : ["Select a profile to preview the llama-server.exe command."]);
  const logLines = $derived(logs.length ? logs.map((entry) => `${entry.timestamp} [${entry.stream}] ${entry.message}`) : ["No runtime logs yet."]);

  async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = typeof data.message === "string" ? data.message : `Request failed with ${response.status}`;
      throw new Error(message);
    }

    return data as T;
  }

  async function loadStatus(): Promise<void> {
    status = await fetchJson<StatusResponse>("/api/status");
  }

  async function loadRuntime(): Promise<void> {
    const response = await fetchJson<RuntimeResponse>("/api/runtime");
    runtime = response.state;
  }

  async function loadProfiles(): Promise<void> {
    const response = await fetchJson<ProfilesResponse>("/api/profiles");
    profiles = response.profiles;
    if (!selectedProfileId && response.profiles.length > 0) {
      selectedProfileId = response.profiles[0].id;
    }
  }

  async function loadLogs(): Promise<void> {
    const response = await fetchJson<{ logs: RuntimeLogEntry[] }>("/api/runtime/logs?limit=200");
    logs = response.logs;
  }

  async function loadCommand(): Promise<void> {
    command = null;
    if (!selectedProfileId) {
      return;
    }

    const response = await fetchJson<{ command: CommandSpec }>(`/api/profiles/${encodeURIComponent(selectedProfileId)}/command`);
    command = response.command;
  }

  async function refreshAll(): Promise<void> {
    isLoading = true;
    errorMessage = null;

    try {
      await Promise.all([loadStatus(), loadRuntime(), loadProfiles(), loadLogs()]);
      await loadCommand();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to load ObsidianLM state.";
    } finally {
      isLoading = false;
    }
  }

  async function runAction(label: string, action: () => Promise<void>): Promise<void> {
    pendingAction = label;
    actionMessage = null;
    errorMessage = null;

    try {
      await action();
      await Promise.all([loadStatus(), loadRuntime(), loadLogs()]);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Action failed.";
    } finally {
      pendingAction = null;
    }
  }

  async function validateSelectedProfile(): Promise<void> {
    if (!selectedProfileId) {
      return;
    }

    await runAction("validate", async () => {
      validation = await fetchJson<ValidationResponse>(`/api/profiles/${encodeURIComponent(selectedProfileId)}/validate`, { method: "POST" });
      actionMessage = validation.valid ? "Profile validation passed." : "Profile validation failed.";
    });
  }

  async function startSelectedProfile(): Promise<void> {
    if (!selectedProfileId) {
      return;
    }

    await runAction("start", async () => {
      const result = await fetchJson<RuntimeActionResult>(`/api/profiles/${encodeURIComponent(selectedProfileId)}/start`, { method: "POST" });
      actionMessage = result.message;
      command = result.command ?? command;
    });
  }

  async function stopRuntime(): Promise<void> {
    await runAction("stop", async () => {
      const result = await fetchJson<RuntimeActionResult>("/api/runtime/stop", { method: "POST" });
      actionMessage = result.message;
    });
  }

  async function restartRuntime(): Promise<void> {
    await runAction("restart", async () => {
      const result = await fetchJson<RuntimeActionResult>("/api/runtime/restart", { method: "POST" });
      actionMessage = result.message;
      command = result.command ?? command;
    });
  }

  async function copyCommand(): Promise<void> {
    if (!command) {
      return;
    }

    await navigator.clipboard.writeText(command.displayCommand);
    actionMessage = "Command copied to clipboard.";
  }

  async function copyLogs(): Promise<void> {
    await navigator.clipboard.writeText(logLines.join("\n"));
    actionMessage = "Recent logs copied to clipboard.";
  }

  function openLogStream(): void {
    eventSource?.close();
    const source = new EventSource("/api/runtime/logs/stream");
    eventSource = source;
    source.addEventListener("log", (event) => {
      const entry = JSON.parse((event as MessageEvent).data) as RuntimeLogEntry;
      logs = [...logs.filter((item) => item.id !== entry.id), entry].slice(-200);
    });
    source.onerror = () => {
      source.close();
      eventSource = null;
      void loadLogs();
    };
  }

  $effect(() => {
    void refreshAll();
    openLogStream();

    return () => {
      eventSource?.close();
    };
  });

  $effect(() => {
    selectedProfileId;
    validation = null;
    void loadCommand().catch((error) => {
      command = null;
      errorMessage = error instanceof Error ? error.message : "Unable to load command preview.";
    });
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
        <a class={`nav-item ${item === "Overview" ? "active" : ""}`} href="/" aria-current={item === "Overview" ? "page" : undefined}>
          <span class={`nav-dot ${item === "Overview" ? "" : "muted"}`} aria-hidden="true"></span>
          {item}
        </a>
      {/each}
    </nav>
  </aside>

  <section class="workspace">
    <header class="topbar">
      <div>
        <p class="eyebrow">Phase 1 runtime cockpit</p>
        <h1>Basic llama.cpp Manager</h1>
        <p class="subtitle">Start, stop, validate, and observe one manually configured llama.cpp server profile. External tools should still connect directly to llama.cpp.</p>
      </div>

      <div class="topbar-status" aria-live="polite">
        <StatusPill tone={serviceState} label={serviceLabel} />
        <ToolbarButton variant="secondary" onclick={refreshAll} disabled={isLoading} title="Refresh dashboard state">
          {isLoading ? "Checking..." : "Refresh"}
        </ToolbarButton>
      </div>
    </header>

    {#if errorMessage}
      <Panel tone="danger" eyebrow="Notice" title="Action needs attention" class="offline-panel">
        <p class="error-detail">{errorMessage}</p>
      </Panel>
    {/if}

    {#if actionMessage}
      <Panel tone="live" eyebrow="Result" title="Latest action" class="offline-panel">
        <p class="empty-copy">{actionMessage}</p>
      </Panel>
    {/if}

    <section class="dashboard-grid" aria-live="polite">
      <Panel tone={runtimeTone === "online" ? "live" : runtimeTone === "danger" ? "danger" : runtimeTone === "warning" ? "warning" : "default"} eyebrow="Runtime status" title={runtimeStatus} class="runtime-status-card">
        <div class="runtime-summary">
          <div class={`runtime-orb runtime-${runtimeStatus}`} aria-hidden="true"></div>
          <div>
            <StatusPill tone={runtimeTone} label={runtimeStatus} />
            <p>{status?.activeRuntime ? "ObsidianLM is managing a runtime from this service session." : "No active managed runtime is running in this service session."}</p>
          </div>
        </div>

        <div class="metric-grid compact">
          <MetricRow label="Active profile" value={status?.activeRuntime?.profileName ?? selectedProfile?.name ?? "None"} muted={!status?.activeRuntime && !selectedProfile} />
          <MetricRow label="PID" value={status?.activeRuntime?.pid ? `${status.activeRuntime.pid}` : "--"} muted={!status?.activeRuntime?.pid} />
          <MetricRow label="llama.cpp API" value={apiUrl} />
          <MetricRow label="Command hash" value={runtime?.commandHash ?? command?.commandHash ?? "--"} muted={!runtime?.commandHash && !command?.commandHash} />
        </div>
      </Panel>

      <Panel eyebrow="Profiles" title="Manual profiles" class="profiles-card">
        {#if profiles.length}
          <label class="field-label" for="profile-select">Selected profile</label>
          <select id="profile-select" class="profile-select" bind:value={selectedProfileId} disabled={Boolean(pendingAction)}>
            {#each profiles as profile}
              <option value={profile.id}>{profile.name}</option>
            {/each}
          </select>
          <p class="helper-text">Profiles are loaded from <code>data/profiles.json</code>. Phase 1 does not edit profiles from the UI.</p>
        {:else}
          <p class="empty-copy">No profiles are configured. Copy <code>data/profiles.example.json</code> into <code>data/profiles.json</code>, then replace the example paths with your local llama-server.exe and GGUF model paths.</p>
        {/if}
      </Panel>

      <Panel eyebrow="Controls" title="Runtime actions" class="controls-card">
        <div class="control-stack" aria-describedby="runtime-controls-help">
          <ToolbarButton variant="secondary" onclick={validateSelectedProfile} disabled={!selectedProfileId || Boolean(pendingAction)}>{pendingAction === "validate" ? "Validating..." : "Validate profile"}</ToolbarButton>
          <ToolbarButton variant="success" onclick={startSelectedProfile} disabled={!selectedProfileId || Boolean(pendingAction) || runtimeStatus === "running" || runtimeStatus === "starting"}>{pendingAction === "start" ? "Starting..." : "Start runtime"}</ToolbarButton>
          <ToolbarButton variant="danger" onclick={stopRuntime} disabled={Boolean(pendingAction) || runtimeStatus === "stopped"}>{pendingAction === "stop" ? "Stopping..." : "Stop runtime"}</ToolbarButton>
          <ToolbarButton variant="secondary" onclick={restartRuntime} disabled={Boolean(pendingAction) || runtimeStatus !== "running"}>{pendingAction === "restart" ? "Restarting..." : "Restart"}</ToolbarButton>
        </div>
        <p id="runtime-controls-help" class="helper-text">Stop only targets the active child process started by this running ObsidianLM service instance.</p>
      </Panel>

      <Panel tone={validation && !validation.valid ? "danger" : validation?.valid ? "live" : "default"} eyebrow="Validation" title="Profile checks">
        {#if validation}
          <p class="empty-copy">{validation.valid ? "Profile is valid." : "Profile is not valid."}</p>
          {#if validation.errors.length}
            <ul class="warning-list">
              {#each validation.errors as validationError}
                <li>{validationError}</li>
              {/each}
            </ul>
          {/if}
        {:else}
          <p class="empty-copy">Run validation before starting a profile. The service checks shape, port, executable path, and model path without starting llama.cpp.</p>
        {/if}
      </Panel>

      <Panel tone="code" eyebrow="Command preview" title="Launch command" class="command-card">
        <div class="panel-actions">
          <ToolbarButton variant="ghost" onclick={copyCommand} disabled={!command}>Copy command</ToolbarButton>
        </div>
        <TerminalBlock label={command?.executable ?? "llama-server.exe"} lines={commandLines} empty={!command} />
      </Panel>

      <Panel tone={warnings.length ? "warning" : "default"} eyebrow="Safety" title="Warnings">
        {#if warnings.length}
          <ul class="warning-list">
            {#each warnings as warning}
              <li>{warning}</li>
            {/each}
          </ul>
        {:else}
          <p class="empty-copy">No warnings reported. ObsidianLM never kills unknown llama-server.exe processes in Phase 1.</p>
        {/if}
      </Panel>

      <Panel tone="code" eyebrow="Logs" title="Runtime output" class="logs-card">
        <div class="panel-actions">
          <ToolbarButton variant="ghost" onclick={copyLogs} disabled={!logs.length}>Copy logs</ToolbarButton>
        </div>
        <TerminalBlock label="runtime.log" lines={logLines} empty={!logs.length} />
      </Panel>
    </section>
  </section>
</main>
