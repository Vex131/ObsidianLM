<script lang="ts">
  import type {
    AppSettings,
    CommandSpec,
    CreateProfileFromDiscoveryRequest,
    CreateProfileFromDiscoveryResponse,
    DiscoveredLlamaCppBuild,
    DiscoveredModel,
    DiscoveryWarning,
    LlamaBuildDiscoveryResponse,
    ModelDiscoveryResponse,
    RuntimeActionResult,
    RuntimeLogEntry,
    RuntimeProfile,
    RuntimeState,
    StatusResponse
  } from "@obsidianlm/shared";
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

  interface SettingsResponse {
    settings: AppSettings;
  }

  const navItems = ["Overview", "Runtime", "Profiles", "Models", "Builds", "Logs", "Settings"];

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
  let settings = $state<AppSettings | null>(null);
  let modelFoldersText = $state("");
  let llamaCppFoldersText = $state("");
  let discoveredModels = $state<DiscoveredModel[]>([]);
  let discoveredBuilds = $state<DiscoveredLlamaCppBuild[]>([]);
  let modelDiscoveryWarnings = $state<DiscoveryWarning[]>([]);
  let buildDiscoveryWarnings = $state<DiscoveryWarning[]>([]);
  let selectedModelPath = $state("");
  let selectedBuildPath = $state("");
  let createdProfilePreview = $state<CommandSpec | null>(null);
  let profileForm = $state({
    name: "",
    host: "0.0.0.0",
    port: 8085,
    ctxSize: 8192,
    gpuLayers: "all",
    flashAttention: true,
    batchSize: 512,
    ubatchSize: 128,
    threads: 8,
    threadsBatch: 8
  });

  const selectedProfile = $derived(profiles.find((profile) => profile.id === selectedProfileId) ?? null);
  const serviceState = $derived(errorMessage ? "offline" : status ? "online" : isLoading ? "unknown" : "warning");
  const serviceLabel = $derived(errorMessage ? "Service unreachable" : status ? "Service online" : isLoading ? "Checking service" : "Status unknown");
  const runtimeStatus = $derived(runtime?.status ?? status?.activeRuntime?.status ?? "stopped");
  const runtimeTone = $derived(runtimeStatus === "running" ? "online" : runtimeStatus === "failed" ? "danger" : runtimeStatus === "starting" || runtimeStatus === "stopping" ? "warning" : "offline");
  const warnings = $derived([...(status?.warnings ?? []), ...(validation?.warnings ?? [])]);
  const apiUrl = $derived(status?.activeRuntime?.apiUrl ?? (selectedProfile ? `http://localhost:${selectedProfile.port}/v1` : `http://localhost:${status?.managedLlamaPort ?? 8085}/v1`));
  const commandLines = $derived(command ? [command.displayCommand] : ["Select a profile to preview the llama-server.exe command."]);
  const logLines = $derived(logs.length ? logs.map((entry) => `${entry.timestamp} [${entry.stream}] ${entry.message}`) : ["No runtime logs yet."]);
  const selectedModel = $derived(discoveredModels.find((model) => model.path === selectedModelPath) ?? null);
  const selectedBuild = $derived(discoveredBuilds.find((build) => build.serverPath === selectedBuildPath) ?? null);
  const discoveryWarningLines = $derived([...modelDiscoveryWarnings, ...buildDiscoveryWarnings].map((warning) => warning.message));

  function formatBytes(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
  }

  function formatDate(value: string): string {
    return new Date(value).toLocaleString();
  }

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

  async function loadSettings(): Promise<void> {
    const response = await fetchJson<SettingsResponse>("/api/settings");
    settings = response.settings;
    modelFoldersText = response.settings.modelFolders.join("\n");
    llamaCppFoldersText = response.settings.llamaCppFolders.join("\n");
    profileForm.port = response.settings.managedLlamaPort;
  }

  async function loadModels(method: "GET" | "POST" = "GET"): Promise<void> {
    const response = await fetchJson<ModelDiscoveryResponse>("/api/discovery/models" + (method === "POST" ? "/rescan" : ""), { method });
    discoveredModels = response.models;
    modelDiscoveryWarnings = response.warnings;
    if (!selectedModelPath && response.models.length) {
      selectedModelPath = response.models[0].path;
    }
  }

  async function loadBuilds(method: "GET" | "POST" = "GET"): Promise<void> {
    const response = await fetchJson<LlamaBuildDiscoveryResponse>("/api/discovery/llama-builds" + (method === "POST" ? "/rescan" : ""), { method });
    discoveredBuilds = response.builds;
    buildDiscoveryWarnings = response.warnings;
    if (!selectedBuildPath && response.builds.length) {
      selectedBuildPath = response.builds[0].serverPath;
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
      await Promise.all([loadStatus(), loadRuntime(), loadProfiles(), loadLogs(), loadSettings(), loadModels(), loadBuilds()]);
      await loadCommand();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to load ObsidianLM state.";
    } finally {
      isLoading = false;
    }
  }

  function linesFromText(value: string): string[] {
    return value.split(/\r?\n/gu).map((line) => line.trim()).filter(Boolean);
  }

  async function saveDiscoveryFolders(): Promise<void> {
    await runAction("save-discovery-folders", async () => {
      const response = await fetchJson<SettingsResponse>("/api/settings/discovery-folders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelFolders: linesFromText(modelFoldersText),
          llamaCppFolders: linesFromText(llamaCppFoldersText)
        })
      });
      settings = response.settings;
      modelFoldersText = response.settings.modelFolders.join("\n");
      llamaCppFoldersText = response.settings.llamaCppFolders.join("\n");
      actionMessage = "Discovery folders saved. Scans still only read configured folders.";
      await Promise.all([loadModels("POST"), loadBuilds("POST")]);
    });
  }

  async function rescanModels(): Promise<void> {
    await runAction("rescan-models", async () => {
      await loadModels("POST");
      actionMessage = "Model scan finished. No model files were read beyond file metadata.";
    });
  }

  async function rescanBuilds(): Promise<void> {
    await runAction("rescan-builds", async () => {
      await loadBuilds("POST");
      actionMessage = "Build scan finished. Detected files were not executed.";
    });
  }

  async function createProfileFromSelection(): Promise<void> {
    if (!selectedModel || !selectedBuild) {
      return;
    }

    await runAction("create-profile", async () => {
      const body: CreateProfileFromDiscoveryRequest = {
        name: profileForm.name.trim() || `${selectedModel.name} ${selectedBuild.name}`,
        modelPath: selectedModel.path,
        buildPath: selectedBuild.serverPath,
        host: profileForm.host,
        port: profileForm.port,
        llamaArgs: {
          ctxSize: profileForm.ctxSize,
          gpuLayers: profileForm.gpuLayers === "all" ? "all" : Number(profileForm.gpuLayers),
          flashAttention: profileForm.flashAttention,
          batchSize: profileForm.batchSize,
          ubatchSize: profileForm.ubatchSize,
          parallel: 1,
          threads: profileForm.threads,
          threadsBatch: profileForm.threadsBatch,
          contBatching: true,
          metrics: true,
          webui: true
        },
        extraArgs: []
      };
      const response = await fetchJson<CreateProfileFromDiscoveryResponse>("/api/discovery/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      createdProfilePreview = response.command;
      command = response.command;
      actionMessage = "Profile created and validated. llama.cpp was not started.";
      await loadProfiles();
      selectedProfileId = response.profile.id;
    });
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
        <p class="eyebrow">Phase 2 discovery cockpit</p>
        <h1>llama.cpp runtime discovery</h1>
        <p class="subtitle">Scan only configured folders for GGUF models and llama.cpp tools, then explicitly create a profile without starting llama.cpp.</p>
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
          <p class="helper-text">Profiles are loaded from <code>data/profiles.json</code>. Discovery-created profiles are saved only after clicking Create profile.</p>
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

      <Panel tone="warning" eyebrow="Settings" title="Discovery folders" class="discovery-settings-card">
        <label class="field-label" for="model-folders">Model folders</label>
        <textarea id="model-folders" class="folder-textarea" bind:value={modelFoldersText} placeholder="D:\Models" rows="4"></textarea>
        <label class="field-label" for="build-folders">llama.cpp build folders</label>
        <textarea id="build-folders" class="folder-textarea" bind:value={llamaCppFoldersText} placeholder="C:\llama.cpp" rows="4"></textarea>
        <div class="panel-actions inline-actions">
          <ToolbarButton variant="secondary" onclick={saveDiscoveryFolders} disabled={Boolean(pendingAction)}>{pendingAction === "save-discovery-folders" ? "Saving..." : "Save discovery folders"}</ToolbarButton>
        </div>
        <p class="helper-text">Only these folders are scanned. Missing folders are saved but reported as warnings during discovery.</p>
        {#if settings && !settings.modelFolders.length && !settings.llamaCppFolders.length}
          <p class="empty-copy">No discovery folders are configured yet.</p>
        {/if}
      </Panel>

      <Panel eyebrow="Models" title="Discovered GGUF models" class="models-card">
        <div class="panel-actions">
          <ToolbarButton variant="ghost" onclick={rescanModels} disabled={Boolean(pendingAction)}>{pendingAction === "rescan-models" ? "Scanning..." : "Rescan models"}</ToolbarButton>
        </div>
        {#if discoveredModels.length}
          <div class="discovery-list">
            {#each discoveredModels as model}
              <button class={`discovery-item ${selectedModelPath === model.path ? "selected" : ""}`} type="button" onclick={() => (selectedModelPath = model.path)}>
                <strong>{model.name}</strong>
                <span>{model.folder}</span>
                <small>{formatBytes(model.sizeBytes)} • modified {formatDate(model.modifiedAt)}</small>
                <code>{model.path}</code>
              </button>
            {/each}
          </div>
        {:else}
          <p class="empty-copy">No .gguf models found in configured folders.</p>
        {/if}
      </Panel>

      <Panel eyebrow="Builds" title="Discovered llama.cpp builds" class="builds-card">
        <div class="panel-actions">
          <ToolbarButton variant="ghost" onclick={rescanBuilds} disabled={Boolean(pendingAction)}>{pendingAction === "rescan-builds" ? "Scanning..." : "Rescan builds"}</ToolbarButton>
        </div>
        {#if discoveredBuilds.length}
          <div class="discovery-list">
            {#each discoveredBuilds as build}
              <button class={`discovery-item ${selectedBuildPath === build.serverPath ? "selected" : ""}`} type="button" onclick={() => (selectedBuildPath = build.serverPath)}>
                <strong>{build.name}</strong>
                <span>{build.folder}</span>
                <small>Tools: {build.tools.map((tool) => tool.fileName).join(", ")}</small>
                <code>{build.serverPath}</code>
              </button>
            {/each}
          </div>
        {:else}
          <p class="empty-copy">No llama-server executable found in configured folders.</p>
        {/if}
      </Panel>

      <Panel tone="live" eyebrow="Create profile" title="Selected model + build" class="create-profile-card">
        <div class="metric-grid compact">
          <MetricRow label="Model" value={selectedModel?.fileName ?? "None selected"} muted={!selectedModel} />
          <MetricRow label="Build" value={selectedBuild?.name ?? "None selected"} muted={!selectedBuild} />
        </div>
        <div class="form-grid">
          <label class="form-field">Profile name<input bind:value={profileForm.name} placeholder={selectedModel && selectedBuild ? `${selectedModel.name} ${selectedBuild.name}` : "Qwen local profile"} /></label>
          <label class="form-field">Host<input bind:value={profileForm.host} /></label>
          <label class="form-field">Port<input type="number" bind:value={profileForm.port} min="1" max="65535" /></label>
          <label class="form-field">Context<input type="number" bind:value={profileForm.ctxSize} min="1" /></label>
          <label class="form-field">GPU layers<input bind:value={profileForm.gpuLayers} /></label>
          <label class="form-field">Batch<input type="number" bind:value={profileForm.batchSize} min="1" /></label>
          <label class="form-field">UBatch<input type="number" bind:value={profileForm.ubatchSize} min="1" /></label>
          <label class="form-field">Threads<input type="number" bind:value={profileForm.threads} min="1" /></label>
          <label class="form-field">Threads batch<input type="number" bind:value={profileForm.threadsBatch} min="1" /></label>
          <label class="checkbox-field"><input type="checkbox" bind:checked={profileForm.flashAttention} /> Flash attention</label>
        </div>
        <div class="panel-actions inline-actions">
          <ToolbarButton variant="success" onclick={createProfileFromSelection} disabled={!selectedModel || !selectedBuild || Boolean(pendingAction)}>{pendingAction === "create-profile" ? "Creating..." : "Create profile"}</ToolbarButton>
        </div>
        <p class="helper-text">Creating a profile appends to <code>data/profiles.json</code>, validates through the Phase 1 profile path, and does not start llama.cpp.</p>
        {#if createdProfilePreview}
          <TerminalBlock label="created profile command" lines={[createdProfilePreview.displayCommand]} />
        {/if}
      </Panel>

      <Panel tone={discoveryWarningLines.length ? "warning" : "default"} eyebrow="Discovery safety" title="Scan warnings">
        {#if discoveryWarningLines.length}
          <ul class="warning-list">
            {#each discoveryWarningLines as warning}
              <li>{warning}</li>
            {/each}
          </ul>
        {:else}
          <p class="empty-copy">Discovery is read-only: it scans configured folders only, skips symlink traversal, and never executes detected tools.</p>
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
