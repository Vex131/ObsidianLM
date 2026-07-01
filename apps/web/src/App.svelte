<script lang="ts">
  import type {
    AppSettings,
    CommandSpec,
    CreateProfileFromDiscoveryRequest,
    CreateProfileFromDiscoveryResponse,
    DiscoveredLlamaCppBuild,
    DiscoveredModel,
    DetectedProcess,
    DiscoveryWarning,
    GpuDevice,
    GpuMonitoringStatus,
    GpuProcess,
    JobRecord,
    LlamaBuildDiscoveryResponse,
    ModelDiscoveryResponse,
    PortStatus,
    ProcessListResponse,
    RuntimeActionResult,
    RuntimeLogEntry,
    RuntimeProfile,
    RuntimeState,
    StartupDetectionSummary,
    StatusResponse
  } from "@obsidianlm/shared";
  import MetricRow from "./lib/components/MetricRow.svelte";
  import Panel from "./lib/components/Panel.svelte";
  import StatusPill from "./lib/components/StatusPill.svelte";
  import TerminalBlock from "./lib/components/TerminalBlock.svelte";
  import ToolbarButton from "./lib/components/ToolbarButton.svelte";
  import ProfileEditor from "./lib/components/profile/ProfileEditor.svelte";

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

  const navItems = ["Overview", "Runtime", "Jobs", "GPU", "Processes", "Profiles", "Models", "Builds", "Logs", "Settings"];

  let status = $state<StatusResponse | null>(null);
  let runtime = $state<RuntimeState | null>(null);
  let profiles = $state<RuntimeProfile[]>([]);
  let selectedProfileId = $state("");
  let command = $state<CommandSpec | null>(null);
  let logs = $state<RuntimeLogEntry[]>([]);
  let jobs = $state<JobRecord[]>([]);
  let selectedJobId = $state("");
  let jobLogs = $state<string[]>([]);
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
  let detection = $state<StartupDetectionSummary | null>(null);
  let detectedProcesses = $state<DetectedProcess[]>([]);
  let portStatus = $state<PortStatus | null>(null);
  let gpuStatus = $state<GpuMonitoringStatus | null>(null);
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
  const detectionWarnings = $derived(detection?.warnings.map((warning) => warning.message) ?? []);
  const selectedProfilePortConflict = $derived(Boolean(selectedProfile && portStatus?.port.port === selectedProfile.port && portStatus.conflict));
  const selectedProfilePortMessage = $derived(selectedProfilePortConflict ? portStatus?.conflictMessage : null);
  const apiUrl = $derived(status?.activeRuntime?.apiUrl ?? (selectedProfile ? `http://localhost:${selectedProfile.port}/v1` : `http://localhost:${status?.managedLlamaPort ?? 8085}/v1`));
  const runningModeLabel = $derived(status?.runningMode === "windowsService" ? "Windows service" : status?.runningMode === "production" ? "Production" : "Development");
  const dataDirModeLabel = $derived(status?.dataDirMode === "programData" ? "ProgramData" : status?.dataDirMode === "custom" ? "Custom" : "Project");
  const logDirModeLabel = $derived(status?.logDirMode === "programData" ? "ProgramData" : status?.logDirMode === "custom" ? "Custom" : "Project");
  const commandLines = $derived(command ? [command.displayCommand] : ["Select a profile to preview the llama-server.exe command."]);
  const logLines = $derived(logs.length ? logs.map((entry) => `${entry.timestamp} [${entry.stream}] ${entry.message}`) : ["No runtime logs yet."]);
  const selectedJob = $derived(jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null);
  const runningJob = $derived(jobs.find((job) => job.status === "queued" || job.status === "running") ?? null);
  const jobLogLines = $derived(jobLogs.length ? jobLogs : ["No job logs selected yet."]);
  const selectedModel = $derived(discoveredModels.find((model) => model.path === selectedModelPath) ?? null);
  const selectedBuild = $derived(discoveredBuilds.find((build) => build.serverPath === selectedBuildPath) ?? null);
  const discoveryWarningLines = $derived([...modelDiscoveryWarnings, ...buildDiscoveryWarnings].map((warning) => warning.message));
  const gpuWarnings = $derived(gpuStatus?.warnings ?? []);
  const gpuTone = $derived(!gpuStatus || gpuStatus.available ? (gpuStatus?.summary.unknownGpuProcessCount ? "warning" : "default") : "warning");

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

  function formatMiB(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return "--";
    }
    if (value >= 1024) {
      return `${(value / 1024).toFixed(value >= 10240 ? 1 : 2)} GiB`;
    }
    return `${value.toFixed(0)} MiB`;
  }

  function formatPercent(value: number | null | undefined): string {
    return value === null || value === undefined ? "--" : `${value.toFixed(0)}%`;
  }

  function formatTemperature(value: number | null | undefined): string {
    return value === null || value === undefined ? "--" : `${value.toFixed(0)} C`;
  }

  function formatPower(draw: number | null | undefined, limit: number | null | undefined): string {
    if (draw === null || draw === undefined) {
      return "--";
    }
    return limit === null || limit === undefined ? `${draw.toFixed(1)} W` : `${draw.toFixed(1)} / ${limit.toFixed(1)} W`;
  }

  function gpuMemoryPercent(gpu: GpuDevice): number {
    if (!gpu.memoryTotalMiB || gpu.memoryUsedMiB === null) {
      return 0;
    }
    return Math.max(0, Math.min(100, (gpu.memoryUsedMiB / gpu.memoryTotalMiB) * 100));
  }

  function gpuProcessLabel(process: GpuProcess): string {
    if (process.kind === "current_managed_runtime") {
      return "Current managed runtime";
    }
    if (process.kind === "possible_llama_runtime") {
      return "Possible llama runtime";
    }
    return "Unknown GPU process";
  }

  function jobTone(statusValue: JobRecord["status"]): "online" | "offline" | "warning" | "danger" | "unknown" {
    if (statusValue === "completed") {
      return "online";
    }
    if (statusValue === "failed") {
      return "danger";
    }
    if (statusValue === "cancelled") {
      return "offline";
    }
    return "warning";
  }

  function formatOptionalDate(value: string | null): string {
    return value ? formatDate(value) : "--";
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

  async function loadDetection(): Promise<void> {
    detection = await fetchJson<StartupDetectionSummary>("/api/runtime/detection");
  }

  async function loadProcesses(): Promise<void> {
    const response = await fetchJson<ProcessListResponse>("/api/processes/llama");
    detectedProcesses = response.processes;
  }

  async function loadPortStatus(): Promise<void> {
    const port = selectedProfile?.port ?? settings?.managedLlamaPort ?? status?.managedLlamaPort ?? 8085;
    portStatus = await fetchJson<PortStatus>(`/api/monitoring/ports?port=${encodeURIComponent(port)}`);
  }

  async function loadGpuStatus(): Promise<void> {
    gpuStatus = await fetchJson<GpuMonitoringStatus>("/api/monitoring/gpu");
  }

  async function loadLogs(): Promise<void> {
    const response = await fetchJson<{ logs: RuntimeLogEntry[] }>("/api/runtime/logs?limit=200");
    logs = response.logs;
  }

  async function loadJobs(): Promise<void> {
    const response = await fetchJson<{ jobs: JobRecord[] }>("/api/jobs");
    jobs = response.jobs;
    if (!selectedJobId && response.jobs.length) {
      selectedJobId = response.jobs[0].id;
    }
  }

  async function loadJobLogs(): Promise<void> {
    if (!selectedJobId) {
      jobLogs = [];
      return;
    }
    const response = await fetchJson<{ job: JobRecord; logs: string[] }>(`/api/jobs/${encodeURIComponent(selectedJobId)}/logs?limit=80`);
    jobLogs = response.logs;
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
      await Promise.all([loadStatus(), loadRuntime(), loadProfiles(), loadLogs(), loadJobs(), loadSettings(), loadModels(), loadBuilds(), loadDetection(), loadProcesses(), loadGpuStatus()]);
      await loadCommand();
      await loadPortStatus();
      await loadJobLogs();
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

  async function refreshGpuStatus(): Promise<void> {
    await runAction("refresh-gpu", async () => {
      await loadGpuStatus();
      actionMessage = "GPU status refreshed using read-only nvidia-smi queries.";
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
      await Promise.all([loadStatus(), loadRuntime(), loadLogs(), loadJobs(), loadDetection(), loadProcesses(), loadPortStatus(), loadGpuStatus()]);
      await loadJobLogs();
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

  async function runTestJob(): Promise<void> {
    await runAction("run-test-job", async () => {
      const response = await fetchJson<{ ok: boolean; message: string; job: JobRecord | null }>("/api/jobs/test", { method: "POST" });
      if (response.job) {
        selectedJobId = response.job.id;
      }
      actionMessage = response.message;
    });
  }

  async function cancelJob(id: string): Promise<void> {
    await runAction("cancel-job", async () => {
      const response = await fetchJson<{ ok: boolean; message: string; job: JobRecord | null }>(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
      actionMessage = response.message;
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

  function setSelectedProfileId(id: string): void {
    selectedProfileId = id;
  }

  function setCommand(commandPreview: CommandSpec | null): void {
    command = commandPreview;
  }

  function setValidationResult(result: ValidationResponse | null): void {
    validation = result;
  }

  function setActionMessage(message: string): void {
    actionMessage = message;
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
    void loadPortStatus().catch(() => {
      portStatus = null;
    });
  });

  $effect(() => {
    selectedJobId;
    void loadJobLogs().catch(() => {
      jobLogs = [];
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
        <p class="eyebrow">Phase 6 job foundation</p>
        <h1>llama.cpp runtime, jobs, GPU monitor, and profile cockpit</h1>
        <p class="subtitle">Manage long-running llama.cpp server profiles separately from one-shot tool jobs. Phase 6 adds a safe generic job foundation without running llama-bench or llama-perplexity yet.</p>
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

      <Panel eyebrow="System" title="Service mode" class="system-card">
        <div class="metric-grid compact">
          <MetricRow label="Running mode" value={runningModeLabel} />
          <MetricRow label="Service mode" value={status?.serviceMode ? "Enabled" : "Disabled"} />
          <MetricRow label="Data directory" value={dataDirModeLabel} />
          <MetricRow label="Log directory" value={logDirModeLabel} />
        </div>
        <p class="helper-text">Windows Service Mode starts only ObsidianLM. llama.cpp profiles still require an explicit start action.</p>
      </Panel>

      <Panel eyebrow="Controls" title="Runtime actions" class="controls-card">
        <div class="control-stack" aria-describedby="runtime-controls-help">
          <ToolbarButton variant="secondary" onclick={validateSelectedProfile} disabled={!selectedProfileId || Boolean(pendingAction)}>{pendingAction === "validate" ? "Validating..." : "Validate profile"}</ToolbarButton>
          <ToolbarButton variant="success" onclick={startSelectedProfile} disabled={!selectedProfileId || Boolean(pendingAction) || runtimeStatus === "running" || runtimeStatus === "starting" || selectedProfilePortConflict}>{pendingAction === "start" ? "Starting..." : "Start runtime"}</ToolbarButton>
          <ToolbarButton variant="danger" onclick={stopRuntime} disabled={Boolean(pendingAction) || runtimeStatus === "stopped"}>{pendingAction === "stop" ? "Stopping..." : "Stop runtime"}</ToolbarButton>
          <ToolbarButton variant="secondary" onclick={restartRuntime} disabled={Boolean(pendingAction) || runtimeStatus !== "running"}>{pendingAction === "restart" ? "Restarting..." : "Restart"}</ToolbarButton>
        </div>
        <p id="runtime-controls-help" class="helper-text">Stop only targets the active child process started by this running ObsidianLM service instance.</p>
        {#if selectedProfilePortMessage}
          <p class="port-conflict-copy">{selectedProfilePortMessage}</p>
        {/if}
      </Panel>

      <Panel tone={runningJob ? "warning" : "default"} eyebrow="Jobs" title="One-shot job queue" class="jobs-card">
        <div class="panel-actions inline-actions">
          <ToolbarButton variant="secondary" onclick={runTestJob} disabled={Boolean(pendingAction) || Boolean(runningJob)}>{pendingAction === "run-test-job" ? "Starting..." : "Run safe test job"}</ToolbarButton>
          {#if runningJob}
            <ToolbarButton variant="danger" onclick={() => cancelJob(runningJob.id)} disabled={Boolean(pendingAction)}>{pendingAction === "cancel-job" ? "Cancelling..." : "Cancel running job"}</ToolbarButton>
          {/if}
        </div>
        <p class="helper-text">Phase 6 allows one active managed job at a time. Cancellation only targets the current in-memory job child process.</p>
        {#if jobs.length}
          <div class="job-list" aria-label="Jobs">
            {#each jobs as job}
              <button class={`job-row ${selectedJob?.id === job.id ? "selected" : ""}`} type="button" onclick={() => (selectedJobId = job.id)}>
                <span><StatusPill tone={jobTone(job.status)} label={job.status} /></span>
                <span>{job.type}</span>
                <span>{formatOptionalDate(job.createdAt)}</span>
                <span>{formatOptionalDate(job.startedAt)}</span>
                <span>{formatOptionalDate(job.finishedAt)}</span>
                <span>{job.exitCode ?? "--"}</span>
              </button>
            {/each}
          </div>
        {:else}
          <p class="empty-copy">No jobs have been run yet. Use the safe test job to verify the generic runner.</p>
        {/if}
        {#if selectedJob}
          <div class="job-detail">
            <div class="metric-grid compact">
              <MetricRow label="Selected job" value={selectedJob.id} />
              <MetricRow label="Executable" value={selectedJob.executable} />
              <MetricRow label="Started" value={formatOptionalDate(selectedJob.startedAt)} />
              <MetricRow label="Finished" value={formatOptionalDate(selectedJob.finishedAt)} />
            </div>
            {#if selectedJob.errorMessage}
              <p class="port-conflict-copy">{selectedJob.errorMessage}</p>
            {/if}
            <TerminalBlock label={selectedJob.logPath ?? "job.log"} lines={jobLogLines} empty={!jobLogs.length} />
          </div>
        {/if}
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

      <ProfileEditor
        {profiles}
        {selectedProfileId}
        {runtime}
        {pendingAction}
        {fetchJson}
        {runAction}
        onProfilesChanged={loadProfiles}
        {setSelectedProfileId}
        {setCommand}
        setValidation={setValidationResult}
        {setActionMessage}
      />

      <Panel tone={warnings.length || detectionWarnings.length ? "warning" : "default"} eyebrow="Startup Safety" title="Detection warnings">
        {#if warnings.length || detectionWarnings.length}
          <ul class="warning-list">
            {#each [...warnings, ...detectionWarnings] as warning}
              <li>{warning}</li>
            {/each}
          </ul>
        {:else}
          <p class="empty-copy">No warnings reported. ObsidianLM never kills unknown llama-server.exe processes and does not auto-start llama.cpp on service startup.</p>
        {/if}
        <div class="classification-strip" aria-label="Detection categories">
          {#each detection?.categories ?? ["no_runtime_detected"] as category}
            <span>{category}</span>
          {/each}
        </div>
      </Panel>

      <Panel tone={portStatus?.conflict ? "danger" : portStatus?.port.inUse ? "warning" : "default"} eyebrow="Port Monitor" title={`Port ${portStatus?.port.port ?? selectedProfile?.port ?? status?.managedLlamaPort ?? 8085}`} class="ports-card">
        <div class="metric-grid compact">
          <MetricRow label="Status" value={portStatus?.port.inUse ? "In use" : "Free"} />
          <MetricRow label="Owner PID" value={portStatus?.port.ownerPid ? `${portStatus.port.ownerPid}` : "Unknown"} muted={!portStatus?.port.ownerPid} />
          <MetricRow label="Host checked" value={portStatus?.port.host ?? "127.0.0.1"} />
          <MetricRow label="Method" value={portStatus?.port.detectionMethod ?? "tcp_connect"} />
        </div>
        {#if portStatus?.conflictMessage}
          <p class="port-conflict-copy">{portStatus.conflictMessage}</p>
        {:else}
          <p class="empty-copy">Profile starts are blocked only when the selected API port is already in use by something other than the current managed child process.</p>
        {/if}
      </Panel>

      <Panel tone={gpuTone} eyebrow="GPU Monitor" title="NVIDIA GPU status" class="gpu-card">
        <div class="panel-actions">
          <ToolbarButton variant="ghost" onclick={refreshGpuStatus} disabled={Boolean(pendingAction)}>{pendingAction === "refresh-gpu" ? "Refreshing..." : "Refresh GPU"}</ToolbarButton>
        </div>
        <div class="metric-grid compact">
          <MetricRow label="GPUs" value={`${gpuStatus?.summary.gpuCount ?? status?.gpu.gpuCount ?? 0}`} />
          <MetricRow label="VRAM used" value={`${formatMiB(gpuStatus?.summary.usedMemoryMiB ?? status?.gpu.usedMemoryMiB)} / ${formatMiB(gpuStatus?.summary.totalMemoryMiB ?? status?.gpu.totalMemoryMiB)}`} />
          <MetricRow label="Managed runtime VRAM" value={formatMiB(gpuStatus?.summary.currentManagedRuntimeGpuMemoryMiB ?? status?.gpu.currentManagedRuntimeGpuMemoryMiB)} muted={!gpuStatus?.summary.currentManagedRuntimeGpuMemoryMiB && !status?.gpu.currentManagedRuntimeGpuMemoryMiB} />
          <MetricRow label="Unknown GPU processes" value={`${gpuStatus?.summary.unknownGpuProcessCount ?? status?.gpu.unknownGpuProcessCount ?? 0}`} />
        </div>
        {#if gpuStatus && !gpuStatus.available}
          <p class="empty-copy">nvidia-smi is not available or no NVIDIA GPU was detected.</p>
        {/if}
        {#if gpuWarnings.length}
          <ul class="warning-list gpu-warning-list">
            {#each gpuWarnings as warning}
              <li>{warning.message}</li>
            {/each}
          </ul>
        {/if}
        {#if gpuStatus?.gpus.length}
          <div class="gpu-list">
            {#each gpuStatus.gpus as gpu}
              <article class="gpu-device-card">
                <div class="gpu-heading">
                  <div>
                    <strong>GPU {gpu.index}: {gpu.name}</strong>
                    <span>{gpu.uuid ?? "UUID unavailable"}</span>
                  </div>
                  <StatusPill tone={gpu.processes.some((process) => process.kind === "current_managed_runtime") ? "online" : "unknown"} label={gpu.processes.some((process) => process.kind === "current_managed_runtime") ? "Managed runtime" : "Read-only"} />
                </div>
                <div class="gpu-memory-bar" aria-label={`GPU ${gpu.index} memory usage`}>
                  <span style={`width: ${gpuMemoryPercent(gpu)}%`}></span>
                </div>
                <div class="metric-grid compact">
                  <MetricRow label="VRAM" value={`${formatMiB(gpu.memoryUsedMiB)} used / ${formatMiB(gpu.memoryTotalMiB)} total`} />
                  <MetricRow label="Free VRAM" value={formatMiB(gpu.memoryFreeMiB)} />
                  <MetricRow label="Utilization" value={formatPercent(gpu.utilizationGpuPercent)} />
                  <MetricRow label="Temperature" value={formatTemperature(gpu.temperatureGpuC)} />
                  <MetricRow label="Power" value={formatPower(gpu.powerDrawW, gpu.powerLimitW)} />
                  <MetricRow label="Driver / CUDA" value={`${gpu.driverVersion ?? "--"} / ${gpu.cudaVersion ?? "--"}`} />
                </div>
              </article>
            {/each}
          </div>
        {/if}
        {#if gpuStatus?.processes.length}
          <div class="gpu-process-table" aria-label="GPU compute processes">
            <div class="gpu-process-row heading"><span>PID</span><span>Process</span><span>GPU</span><span>VRAM</span><span>Classification</span></div>
            {#each gpuStatus.processes as process}
              <div class={`gpu-process-row ${process.kind === "current_managed_runtime" ? "managed" : process.kind === "unknown_gpu_process" ? "unknown" : ""}`}>
                <span>{process.pid}</span>
                <span>{process.processName}</span>
                <span>{process.gpuIndex === null ? "Unknown" : `GPU ${process.gpuIndex}`}</span>
                <span>{formatMiB(process.usedMemoryMiB)}</span>
                <span>{gpuProcessLabel(process)}</span>
              </div>
            {/each}
          </div>
        {:else if gpuStatus?.available}
          <p class="empty-copy">No active GPU compute processes were reported by nvidia-smi.</p>
        {/if}
        <p class="helper-text">Read-only in Phase 4: ObsidianLM lists GPU processes but never kills, adopts, or changes GPU settings.</p>
      </Panel>

      <Panel tone={detectedProcesses.length ? "warning" : "default"} eyebrow="Processes" title="Detected llama-server processes" class="processes-card">
        {#if detectedProcesses.length}
          <div class="process-list">
            {#each detectedProcesses as process}
              <article class="process-card">
                <div class="process-heading">
                  <strong>PID {process.pid}</strong>
                  <span>{process.confidence} confidence</span>
                </div>
                <p>{process.name}</p>
                {#if process.executablePath}<code>{process.executablePath}</code>{/if}
                {#if process.commandLine}<details><summary>Command line</summary><code>{process.commandLine}</code></details>{/if}
                <small>{process.reasons.join(" ")}</small>
              </article>
            {/each}
          </div>
          <p class="helper-text">Read-only in Phase 3: no kill, adopt, or stop controls are offered for detected external processes.</p>
        {:else}
          <p class="empty-copy">No llama-server-like processes were detected. llama-bench, llama-perplexity, and llama-cli are not treated as server runtimes.</p>
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
