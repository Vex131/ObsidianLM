<script lang="ts">
  import type {
    AppSettings,
    AdminTokenRequest,
    AuthLogoutResponse,
    AuthSetupResponse,
    AuthStatusResponse,
    AuthVerifyResponse,
    CommandSpec,
    CreateProfileFromDiscoveryRequest,
    CreateProfileFromDiscoveryResponse,
    DiscoveredLlamaCppBuild,
    DiscoveredLlamaCppTool,
    DiscoveredModel,
    DetectedProcess,
    DiscoveryWarning,
    GpuDevice,
    GpuMonitoringStatus,
    GpuProcess,
    JobActionResponse,
    JobRecord,
    LlamaBuildDiscoveryResponse,
    ModelDiscoveryResponse,
    PortStatus,
    ProcessListResponse,
    RuntimeActionResult,
    RuntimeLogEntry,
    RuntimeLogsResponse,
    RuntimeLogsStreamEvent,
    RuntimeProfile,
    RuntimeHealthResponse,
    RuntimeState,
    RuntimeTestChatRequest,
    RuntimeTestChatResponse,
    StartupDetectionSummary,
    StatusResponse
  } from "@obsidianlm/shared";
  import MetricRow from "./lib/components/MetricRow.svelte";
  import Panel from "./lib/components/Panel.svelte";
  import StatusPill from "./lib/components/StatusPill.svelte";
  import TerminalBlock from "./lib/components/TerminalBlock.svelte";
  import ToolbarButton from "./lib/components/ToolbarButton.svelte";
  import ProfileEditor from "./lib/components/profile/ProfileEditor.svelte";
  import RuntimeDiagnosticsPanel from "./lib/components/runtime/RuntimeDiagnosticsPanel.svelte";
  import JobsPanel from "./lib/components/jobs/JobsPanel.svelte";
  import { friendlyRequestError, publicFetchJson } from "./lib/api";
  import { formatBytes, formatDate, formatMiB, formatOptionalDate, formatPercent, formatPower, formatTemperature, gpuMemoryPercent } from "./lib/format";

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

  interface LlamaBenchRequestPayload {
    buildId: string;
    benchPath: string;
    modelPath: string;
    args: {
      threads: number;
      ctxSize: number;
      batchSize: number;
      ubatchSize: number;
      nGpuLayers: number;
      promptTokens: number;
      generationTokens: number;
      repetitions: number;
    };
  }

  interface LlamaBenchResultRowView {
    test: string;
    backend?: string;
    threads?: string;
    nPrompt?: string;
    nGen?: string;
    testTime?: string;
    tokensPerSecond?: number;
  }

  interface LlamaBenchResultView {
    type: "llama-bench";
    rows: LlamaBenchResultRowView[];
  }

  type JobRecordWithOptionalResult = JobRecord & { result?: LlamaBenchResultView | null };

  const navItems = ["Overview", "Runtime", "Jobs", "GPU", "Processes", "Profiles", "Models", "Builds", "Logs", "Settings"];
  const adminTokenStorageKey = "obsidianlm.adminToken";

  type AuthMode = "checking" | "setup-required" | "logged-out" | "logged-in";

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
  let authMode = $state<AuthMode>("checking");
  let authStatus = $state<AuthStatusResponse | null>(null);
  let adminToken = $state<string | null>(null);
  let tokenInput = $state("");
  let tokenConfirmInput = $state("");
  let authMessage = $state<string | null>(null);
  let authErrorMessage = $state<string | null>(null);
  let authPendingAction = $state<"setup" | "login" | "logout" | null>(null);
  let logStreamAbortController: AbortController | null = null;
  let logStreamReconnectTimer: number | null = null;
  let logStreamState = $state<"connecting" | "connected" | "disconnected">("disconnected");
  let logSearch = $state("");
  let lastLogHeartbeat = $state<string | null>(null);
  let settings = $state<AppSettings | null>(null);
  let modelFoldersText = $state("");
  let llamaCppFoldersText = $state("");
  let discoveredModels = $state<DiscoveredModel[]>([]);
  let discoveredBuilds = $state<DiscoveredLlamaCppBuild[]>([]);
  let detection = $state<StartupDetectionSummary | null>(null);
  let detectedProcesses = $state<DetectedProcess[]>([]);
  let portStatus = $state<PortStatus | null>(null);
  let gpuStatus = $state<GpuMonitoringStatus | null>(null);
  let runtimeHealth = $state<RuntimeHealthResponse | null>(null);
  let testChatResult = $state<RuntimeTestChatResponse | null>(null);
  let modelDiscoveryWarnings = $state<DiscoveryWarning[]>([]);
  let buildDiscoveryWarnings = $state<DiscoveryWarning[]>([]);
  let selectedModelPath = $state("");
  let selectedBuildPath = $state("");
  let selectedBenchModelPath = $state("");
  let selectedBenchPath = $state("");
  let benchThreadsInitialized = false;
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
  let benchForm = $state({
    nGpuLayers: 0,
    ctxSize: 8192,
    batchSize: 512,
    ubatchSize: 128,
    threads: 8,
    promptTokens: 512,
    generationTokens: 128,
    repetitions: 3
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
  const filteredLogs = $derived.by(() => {
    const query = logSearch.trim().toLowerCase();
    const visibleLogs = query
      ? logs.filter((entry) => `${entry.timestamp} ${entry.source} ${entry.message}`.toLowerCase().includes(query))
      : logs;

    return visibleLogs.slice(-500);
  });
  const logLines = $derived(filteredLogs.length ? filteredLogs.map((entry) => `${entry.timestamp} [${entry.source}] ${entry.message}`) : [logs.length ? "No visible logs match the current filter." : "No runtime logs yet."]);
  const logConnectionTone = $derived(logStreamState === "connected" ? "online" : logStreamState === "connecting" ? "warning" : "offline");
  const logStatusText = $derived(runtimeStatus === "running" ? "Managed runtime active" : "Runtime stopped or unavailable");
  const selectedJob = $derived(jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null);
  const selectedJobBenchResult = $derived((selectedJob as JobRecordWithOptionalResult | null)?.result?.type === "llama-bench" ? (selectedJob as JobRecordWithOptionalResult).result : null);
  const runningJob = $derived(jobs.find((job) => job.status === "queued" || job.status === "running") ?? null);
  const jobLogLines = $derived(jobLogs.length ? jobLogs : ["No job logs selected yet."]);
  const selectedModel = $derived(discoveredModels.find((model) => model.path === selectedModelPath) ?? null);
  const selectedBuild = $derived(discoveredBuilds.find((build) => build.serverPath === selectedBuildPath) ?? null);
  const selectedBenchModel = $derived(discoveredModels.find((model) => model.path === selectedBenchModelPath) ?? discoveredModels[0] ?? null);
  const benchToolOptions = $derived.by(() => {
    return discoveredBuilds.flatMap((build) =>
      build.tools
        .filter(isBenchTool)
        .map((tool) => ({ build, tool }))
    );
  });
  const selectedBenchTool = $derived(benchToolOptions.find((option) => option.tool.path === selectedBenchPath) ?? benchToolOptions[0] ?? null);
  const discoveryWarningLines = $derived([...modelDiscoveryWarnings, ...buildDiscoveryWarnings].map((warning) => warning.message));
  const gpuWarnings = $derived(gpuStatus?.warnings ?? []);
  const gpuTone = $derived(!gpuStatus || gpuStatus.available ? (gpuStatus?.summary.unknownGpuProcessCount ? "warning" : "default") : "warning");

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

  function isBenchTool(tool: DiscoveredLlamaCppTool): boolean {
    return tool.exists && (tool.kind === "bench" || tool.fileName.toLowerCase().includes("llama-bench"));
  }

  function defaultBenchThreads(profileList: RuntimeProfile[]): number {
    const configuredThreads = profileList.find((profile) => typeof profile.llamaArgs?.threads === "number")?.llamaArgs?.threads;
    return configuredThreads && configuredThreads > 0 ? configuredThreads : 8;
  }

  function readStoredAdminToken(): string | null {
    return localStorage.getItem(adminTokenStorageKey);
  }

  function writeStoredAdminToken(token: string): void {
    localStorage.setItem(adminTokenStorageKey, token);
  }

  function clearStoredAdminToken(): void {
    localStorage.removeItem(adminTokenStorageKey);
  }

  async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (adminToken) {
      headers.set("Authorization", `Bearer ${adminToken}`);
    }

    const response = await fetch(url, { ...init, headers });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        clearProtectedState();
        clearStoredAdminToken();
        adminToken = null;
        authMode = "logged-out";
      }
      const message = typeof data.message === "string" ? data.message : undefined;
      throw new Error(friendlyRequestError(response.status, message));
    }

    return data as T;
  }

  function clearProtectedState(): void {
    runtime = null;
    profiles = [];
    selectedProfileId = "";
    command = null;
    logs = [];
    jobs = [];
    selectedJobId = "";
    jobLogs = [];
    validation = null;
    settings = null;
    modelFoldersText = "";
    llamaCppFoldersText = "";
    discoveredModels = [];
    discoveredBuilds = [];
    detection = null;
    detectedProcesses = [];
    portStatus = null;
    gpuStatus = null;
    runtimeHealth = null;
    testChatResult = null;
    modelDiscoveryWarnings = [];
    buildDiscoveryWarnings = [];
    selectedModelPath = "";
    selectedBuildPath = "";
    selectedBenchModelPath = "";
    selectedBenchPath = "";
    benchThreadsInitialized = false;
    createdProfilePreview = null;
    closeLogStream();
  }

  async function initializeAuth(): Promise<void> {
    authMode = "checking";
    authErrorMessage = null;
    authMessage = null;
    isLoading = true;

    try {
      authStatus = await publicFetchJson<AuthStatusResponse>("/api/auth/status");
      if (!authStatus.configured) {
        clearStoredAdminToken();
        adminToken = null;
        authMode = "setup-required";
        clearProtectedState();
        return;
      }

      const storedToken = readStoredAdminToken();
      if (!storedToken) {
        authMode = "logged-out";
        clearProtectedState();
        return;
      }

      const verifyResponse = await publicFetchJson<AuthVerifyResponse>("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: storedToken } satisfies AdminTokenRequest)
      });

      if (!verifyResponse.ok) {
        clearStoredAdminToken();
        adminToken = null;
        authMode = "logged-out";
        clearProtectedState();
        authErrorMessage = "Invalid token";
        return;
      }

      adminToken = storedToken;
      authMode = "logged-in";
    } catch (error) {
      authMode = "logged-out";
      clearProtectedState();
      authErrorMessage = error instanceof Error ? error.message : "Unable to check authentication.";
    } finally {
      isLoading = false;
    }
  }

  async function submitSetup(): Promise<void> {
    const token = tokenInput.trim();
    authPendingAction = "setup";
    authErrorMessage = null;
    authMessage = null;

    try {
      if (!token) {
        throw new Error("Enter admin token");
      }
      if (tokenConfirmInput.trim() && tokenConfirmInput.trim() !== token) {
        throw new Error("Admin tokens do not match.");
      }

      await publicFetchJson<AuthSetupResponse>("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token } satisfies AdminTokenRequest)
      });
      writeStoredAdminToken(token);
      adminToken = token;
      tokenInput = "";
      tokenConfirmInput = "";
      authStatus = { configured: true, authRequired: true };
      authMode = "logged-in";
    } catch (error) {
      authErrorMessage = error instanceof Error ? error.message : "Unable to set up admin token.";
    } finally {
      authPendingAction = null;
    }
  }

  async function submitLogin(): Promise<void> {
    const token = tokenInput.trim();
    authPendingAction = "login";
    authErrorMessage = null;
    authMessage = null;

    try {
      if (!token) {
        throw new Error("Enter admin token");
      }
      const verifyResponse = await publicFetchJson<AuthVerifyResponse>("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token } satisfies AdminTokenRequest)
      });
      if (!verifyResponse.ok) {
        throw new Error("Invalid token");
      }
      writeStoredAdminToken(token);
      adminToken = token;
      tokenInput = "";
      authMode = "logged-in";
    } catch {
      authErrorMessage = "Invalid token";
      clearStoredAdminToken();
      adminToken = null;
    } finally {
      authPendingAction = null;
    }
  }

  async function logout(): Promise<void> {
    authPendingAction = "logout";
    try {
      await publicFetchJson<AuthLogoutResponse>("/api/auth/logout", { method: "POST" }).catch(() => ({ ok: true }));
    } finally {
      clearStoredAdminToken();
      adminToken = null;
      tokenInput = "";
      clearProtectedState();
      authMessage = "Logged out";
      authErrorMessage = null;
      authMode = authStatus?.configured === false ? "setup-required" : "logged-out";
      authPendingAction = null;
      isLoading = false;
    }
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
    if (!benchThreadsInitialized) {
      benchForm.threads = defaultBenchThreads(response.profiles);
      benchThreadsInitialized = true;
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
    if (!selectedBenchModelPath && response.models.length) {
      selectedBenchModelPath = response.models[0].path;
    }
  }

  async function loadBuilds(method: "GET" | "POST" = "GET"): Promise<void> {
    const response = await fetchJson<LlamaBuildDiscoveryResponse>("/api/discovery/llama-builds" + (method === "POST" ? "/rescan" : ""), { method });
    discoveredBuilds = response.builds;
    buildDiscoveryWarnings = response.warnings;
    if (!selectedBuildPath && response.builds.length) {
      selectedBuildPath = response.builds[0].serverPath;
    }
    const benchTools = response.builds.flatMap((build) => build.tools.filter(isBenchTool));
    if (!selectedBenchPath || !benchTools.some((tool) => tool.path === selectedBenchPath)) {
      const firstBenchTool = benchTools[0];
      selectedBenchPath = firstBenchTool?.path ?? "";
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

  async function loadRuntimeHealth(): Promise<void> {
    runtimeHealth = await fetchJson<RuntimeHealthResponse>("/api/runtime/health");
  }

  async function checkRuntimeHealth(): Promise<void> {
    await runAction("runtime-health", async () => {
      await loadRuntimeHealth();
      actionMessage = runtimeHealth?.ok ? "Runtime health check passed." : runtimeHealth?.message ?? "Runtime health check completed.";
    });
  }

  async function runRuntimeTestChat(prompt: string): Promise<void> {
    await runAction("test-chat", async () => {
      testChatResult = await fetchJson<RuntimeTestChatResponse>("/api/runtime/test-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt } satisfies RuntimeTestChatRequest)
      });
      actionMessage = testChatResult.ok ? "Diagnostic test chat completed." : testChatResult.message;
    });
  }

  async function loadLogs(): Promise<void> {
    const response = await fetchJson<RuntimeLogsResponse>("/api/runtime/logs?limit=300");
    logs = response.logs.slice(-500);
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
      await Promise.all([loadStatus(), loadRuntime(), loadProfiles(), loadLogs(), loadJobs(), loadSettings(), loadModels(), loadBuilds(), loadDetection(), loadProcesses(), loadGpuStatus(), loadRuntimeHealth()]);
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

  async function runLlamaBenchJob(): Promise<void> {
    if (!selectedBenchModel || !selectedBenchTool) {
      return;
    }

    await runAction("run-llama-bench", async () => {
      const body: LlamaBenchRequestPayload = {
        buildId: selectedBenchTool.build.id,
        benchPath: selectedBenchTool.tool.path,
        modelPath: selectedBenchModel.path,
        args: {
          threads: benchForm.threads,
          ctxSize: benchForm.ctxSize,
          batchSize: benchForm.batchSize,
          ubatchSize: benchForm.ubatchSize,
          nGpuLayers: benchForm.nGpuLayers,
          promptTokens: benchForm.promptTokens,
          generationTokens: benchForm.generationTokens,
          repetitions: benchForm.repetitions
        }
      };
      const response = await fetchJson<JobActionResponse>("/api/jobs/llama-bench", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
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
    actionMessage = "Visible runtime logs copied to clipboard.";
  }

  function clearVisibleLogs(): void {
    logs = [];
    actionMessage = "Visible runtime logs cleared. Log files were not deleted.";
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

  function closeLogStream(): void {
    if (logStreamReconnectTimer !== null) {
      window.clearTimeout(logStreamReconnectTimer);
      logStreamReconnectTimer = null;
    }
    logStreamAbortController?.abort();
    logStreamAbortController = null;
    logStreamState = "disconnected";
  }

  function scheduleLogStreamReconnect(): void {
    if (authMode !== "logged-in" || logStreamReconnectTimer !== null) {
      return;
    }
    logStreamReconnectTimer = window.setTimeout(() => {
      logStreamReconnectTimer = null;
      openLogStream();
    }, 2500);
  }

  function handleLogStreamEvent(eventName: RuntimeLogsStreamEvent["event"] | "message", dataText: string): void {
    try {
      if (eventName === "connection") {
        logStreamState = "connected";
        return;
      }
      if (eventName === "log") {
        const entry = JSON.parse(dataText) as RuntimeLogEntry;
        logs = [...logs.filter((item) => `${item.timestamp}-${item.sequence}` !== `${entry.timestamp}-${entry.sequence}`), entry].slice(-500);
        logStreamState = "connected";
        return;
      }
      if (eventName === "heartbeat") {
        const data = JSON.parse(dataText) as { timestamp?: string };
        lastLogHeartbeat = data.timestamp ?? new Date().toISOString();
        logStreamState = "connected";
        return;
      }
      if (eventName === "stopped") {
        logStreamState = "disconnected";
      }
    } catch {
      logStreamState = "connected";
    }
  }

  function processSseBlock(block: string): void {
    let eventName: RuntimeLogsStreamEvent["event"] | "message" = "message";
    const dataLines: string[] = [];

    for (const rawLine of block.split(/\r?\n/u)) {
      const line = rawLine.trimEnd();
      if (!line || line.startsWith(":")) {
        continue;
      }
      if (line.startsWith("event:")) {
        const value = line.slice(6).trim();
        if (value === "connection" || value === "log" || value === "heartbeat" || value === "stopped") {
          eventName = value;
        }
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    handleLogStreamEvent(eventName, dataLines.join("\n"));
  }

  async function readLogStream(response: Response): Promise<void> {
    if (!response.body) {
      throw new Error("Log stream unavailable.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const normalized = buffer.replace(/\r\n/gu, "\n");
      const blocks = normalized.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        processSseBlock(block);
      }
      if (done) {
        if (buffer.trim()) {
          processSseBlock(buffer);
        }
        return;
      }
    }
  }

  function openLogStream(): void {
    closeLogStream();
    if (authMode !== "logged-in" || !adminToken) {
      return;
    }

    const controller = new AbortController();
    logStreamAbortController = controller;
    logStreamState = "connecting";

    void (async () => {
      try {
        const headers = new Headers();
        headers.set("Authorization", `Bearer ${adminToken}`);
        const response = await fetch("/api/runtime/logs/stream?limit=100", {
          headers,
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(friendlyRequestError(response.status));
        }
        await readLogStream(response);
      } catch (error) {
        if (!controller.signal.aborted) {
          logStreamState = "disconnected";
          void loadLogs().catch(() => undefined);
          scheduleLogStreamReconnect();
        }
      }
    })();
  }

  $effect(() => {
    void initializeAuth();
  });

  $effect(() => {
    if (authMode !== "logged-in") {
      closeLogStream();
      return;
    }

    void refreshAll();
    openLogStream();

    return () => {
      closeLogStream();
    };
  });

  $effect(() => {
    selectedProfileId;
    if (authMode !== "logged-in") {
      return;
    }
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
    if (authMode !== "logged-in") {
      return;
    }
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
        {#if authMode === "logged-in"}
          <ToolbarButton variant="secondary" onclick={refreshAll} disabled={isLoading} title="Refresh dashboard state">
            {isLoading ? "Checking..." : "Refresh"}
          </ToolbarButton>
          <ToolbarButton variant="ghost" onclick={logout} disabled={authPendingAction === "logout"} title="Clear saved admin token">
            {authPendingAction === "logout" ? "Logging out..." : "Logout"}
          </ToolbarButton>
        {/if}
      </div>
    </header>

    {#if authMode === "checking"}
      <Panel tone="code" eyebrow="Authentication" title="Checking admin access" class="auth-panel">
        <p class="empty-copy">Checking ObsidianLM authentication status...</p>
      </Panel>
    {:else if authMode === "setup-required"}
      <Panel tone="live" eyebrow="Authentication" title="Set up admin token" class="auth-panel">
        <form class="auth-form" onsubmit={(event) => { event.preventDefault(); void submitSetup(); }}>
          <p class="empty-copy">Create the local admin token used to unlock protected ObsidianLM controls in this browser.</p>
          <label class="form-field">Admin token<input type="password" autocomplete="new-password" bind:value={tokenInput} placeholder="Set up admin token" /></label>
          <label class="form-field">Confirm token<input type="password" autocomplete="new-password" bind:value={tokenConfirmInput} placeholder="Repeat admin token" /></label>
          {#if authErrorMessage}<p class="auth-error">{authErrorMessage}</p>{/if}
          <div class="panel-actions inline-actions">
            <ToolbarButton type="submit" variant="success" disabled={authPendingAction === "setup"}>{authPendingAction === "setup" ? "Saving..." : "Set up admin token"}</ToolbarButton>
          </div>
          <p class="helper-text">Stored in browser localStorage for v1 only. Token values are never placed in URLs.</p>
        </form>
      </Panel>
    {:else if authMode === "logged-out"}
      <Panel tone="code" eyebrow="Authentication" title="Enter admin token" class="auth-panel">
        <form class="auth-form" onsubmit={(event) => { event.preventDefault(); void submitLogin(); }}>
          {#if authMessage}<p class="auth-success">{authMessage}</p>{/if}
          <p class="empty-copy">Enter admin token to load runtime profiles, jobs, settings, and live logs.</p>
          <label class="form-field">Admin token<input type="password" autocomplete="current-password" bind:value={tokenInput} placeholder="Enter admin token" /></label>
          {#if authErrorMessage}<p class="auth-error">{authErrorMessage}</p>{/if}
          <div class="panel-actions inline-actions">
            <ToolbarButton type="submit" variant="primary" disabled={authPendingAction === "login"}>{authPendingAction === "login" ? "Checking..." : "Login"}</ToolbarButton>
          </div>
        </form>
      </Panel>
    {:else}

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

      <RuntimeDiagnosticsPanel
        health={runtimeHealth}
        {testChatResult}
        {pendingAction}
        onCheckHealth={checkRuntimeHealth}
        onRunTestChat={runRuntimeTestChat}
      />

      <JobsPanel
        {jobs}
        bind:selectedJobId
        {selectedJob}
        selectedJobBenchResult={selectedJobBenchResult as never}
        {runningJob}
        {jobLogs}
        {jobLogLines}
        {discoveredModels}
        bind:selectedBenchModelPath
        {benchToolOptions}
        bind:selectedBenchPath
        {selectedBenchModel}
        {selectedBenchTool}
        {benchForm}
        {pendingAction}
        {runTestJob}
        {cancelJob}
        {runLlamaBenchJob}
        {jobTone}
      />

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
        <div class="logs-toolbar">
          <div class="log-status-strip">
            <StatusPill tone={logConnectionTone} label={`Live stream ${logStreamState}`} />
            <span>{logStatusText}</span>
            {#if lastLogHeartbeat}
              <small>Heartbeat {formatDate(lastLogHeartbeat)}</small>
            {/if}
          </div>
          <div class="panel-actions inline-actions logs-actions">
            <ToolbarButton variant="ghost" onclick={loadLogs}>Refresh</ToolbarButton>
            <ToolbarButton variant="ghost" onclick={copyLogs} disabled={!filteredLogs.length}>Copy visible</ToolbarButton>
            <ToolbarButton variant="ghost" onclick={clearVisibleLogs} disabled={!logs.length}>Clear visible</ToolbarButton>
          </div>
        </div>

        <label class="field-label" for="runtime-log-search">Search visible logs</label>
        <input id="runtime-log-search" class="log-search-input" bind:value={logSearch} placeholder="Filter by message, source, or timestamp" />

        <div class="log-viewer" aria-label="Runtime logs">
          {#if filteredLogs.length}
            {#each filteredLogs as entry (`${entry.timestamp}-${entry.sequence}`)}
              <div class={`log-entry log-source-${entry.source}`}>
                <span class="log-time">{entry.timestamp}</span>
                <span class="log-source">{entry.source}</span>
                <span class="log-message">{entry.message}</span>
              </div>
            {/each}
          {:else}
            <p class="empty-copy">{logs.length ? "No visible logs match the current filter." : "No runtime logs are available yet. Start a managed profile to stream stdout and stderr here."}</p>
          {/if}
        </div>

        <p class="helper-text">Showing up to 500 visible entries. Clear only affects this UI buffer; persisted runtime log files are kept by the service.</p>
      </Panel>
    </section>
    {/if}
  </section>
</main>
