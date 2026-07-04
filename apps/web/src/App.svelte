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
    DiscoveredToolInputFile,
    DetectedProcess,
    DiscoveryWarning,
    GpuDevice,
    GpuMonitoringStatus,
    GpuProcess,
    JobActionResponse,
    JobRecord,
    LlamaBuildDiscoveryResponse,
    LlamaPerplexityJobResult,
    ModelDiscoveryResponse,
    PortStatus,
    ProcessListResponse,
    RuntimeActionResult,
    RuntimeLogEntry,
    RuntimeLogsResponse,
    RuntimeLogsStreamEvent,
    RuntimeProfile,
    RuntimeHealthResponse,
    ReadinessResponse,
    RuntimeState,
    RuntimeTestChatRequest,
    RuntimeTestChatResponse,
    StartupDetectionSummary,
    StatusResponse
  } from "@obsidianlm/shared";
  import { onMount } from "svelte";
  import Panel from "./lib/components/Panel.svelte";
  import ToolbarButton from "./lib/components/ToolbarButton.svelte";
  import { friendlyRequestError, publicFetchJson } from "./lib/api";
  import { formatBytes, formatDate, formatMiB } from "./lib/format";
  import AppShell from "./lib/layout/AppShell.svelte";
  import { defaultPage, pageFromHash, type PageId } from "./lib/navigation";
  import DashboardInspector from "./lib/inspectors/DashboardInspector.svelte";
  import RuntimeInspector from "./lib/inspectors/RuntimeInspector.svelte";
  import ProfileInspector from "./lib/inspectors/ProfileInspector.svelte";
  import ModelInspector from "./lib/inspectors/ModelInspector.svelte";
  import BuildInspector from "./lib/inspectors/BuildInspector.svelte";
  import DashboardPage from "./lib/pages/DashboardPage.svelte";
  import RuntimePage from "./lib/pages/RuntimePage.svelte";
  import ProfilesPage from "./lib/pages/ProfilesPage.svelte";
  import ModelsPage from "./lib/pages/ModelsPage.svelte";
  import BuildsPage from "./lib/pages/BuildsPage.svelte";
  import JobsPage from "./lib/pages/JobsPage.svelte";
  import LogsPage from "./lib/pages/LogsPage.svelte";
  import TelemetryPage from "./lib/pages/TelemetryPage.svelte";
  import SettingsPage from "./lib/pages/SettingsPage.svelte";
  import SystemPage from "./lib/pages/SystemPage.svelte";

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

  interface ToolInputDiscoveryResponse {
    files: DiscoveredToolInputFile[];
    warnings: DiscoveryWarning[];
    scannedFolders: string[];
    detectedAt: string;
  }

  interface LlamaPerplexityRequestPayload {
    buildId: string;
    perplexityPath: string;
    modelPath: string;
    datasetPath: string;
    args: {
      threads: number;
      ctxSize: number;
      batchSize: number;
      ubatchSize: number;
      nGpuLayers: number;
    };
  }

  type JobRecordWithOptionalResult = JobRecord & { result?: LlamaBenchResultView | LlamaPerplexityJobResult | null };

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
  let activePage = $state<PageId>(defaultPage);
  let logStreamAbortController: AbortController | null = null;
  let logStreamReconnectTimer: number | null = null;
  let logStreamState = $state<"connecting" | "connected" | "disconnected">("disconnected");
  let logSearch = $state("");
  let lastLogHeartbeat = $state<string | null>(null);
  let settings = $state<AppSettings | null>(null);
  let modelFoldersText = $state("");
  let llamaCppFoldersText = $state("");
  let toolInputFoldersText = $state("");
  let discoveredModels = $state<DiscoveredModel[]>([]);
  let discoveredBuilds = $state<DiscoveredLlamaCppBuild[]>([]);
  let discoveredToolInputs = $state<DiscoveredToolInputFile[]>([]);
  let detection = $state<StartupDetectionSummary | null>(null);
  let detectedProcesses = $state<DetectedProcess[]>([]);
  let portStatus = $state<PortStatus | null>(null);
  let gpuStatus = $state<GpuMonitoringStatus | null>(null);
  let runtimeHealth = $state<RuntimeHealthResponse | null>(null);
  let readiness = $state<ReadinessResponse | null>(null);
  let testChatResult = $state<RuntimeTestChatResponse | null>(null);
  let modelDiscoveryWarnings = $state<DiscoveryWarning[]>([]);
  let buildDiscoveryWarnings = $state<DiscoveryWarning[]>([]);
  let toolInputDiscoveryWarnings = $state<DiscoveryWarning[]>([]);
  let selectedModelPath = $state("");
  let selectedBuildPath = $state("");
  let selectedBenchModelPath = $state("");
  let selectedBenchPath = $state("");
  let selectedPerplexityModelPath = $state("");
  let selectedPerplexityPath = $state("");
  let selectedDatasetPath = $state("");
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
  let perplexityForm = $state({
    nGpuLayers: 0,
    ctxSize: 8192,
    batchSize: 512,
    ubatchSize: 128,
    threads: 8
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
  const selectedJobPerplexityResult = $derived((selectedJob as JobRecordWithOptionalResult | null)?.result?.type === "llama-perplexity" ? (selectedJob as JobRecordWithOptionalResult).result as LlamaPerplexityJobResult : null);
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
  const selectedPerplexityModel = $derived(discoveredModels.find((model) => model.path === selectedPerplexityModelPath) ?? discoveredModels[0] ?? null);
  const perplexityToolOptions = $derived.by(() => {
    return discoveredBuilds.flatMap((build) =>
      build.tools
        .filter(isPerplexityTool)
        .map((tool) => ({ build, tool }))
    );
  });
  const selectedPerplexityTool = $derived(perplexityToolOptions.find((option) => option.tool.path === selectedPerplexityPath) ?? perplexityToolOptions[0] ?? null);
  const selectedDataset = $derived(discoveredToolInputs.find((input) => input.path === selectedDatasetPath) ?? discoveredToolInputs[0] ?? null);
  const discoveryWarningLines = $derived([...modelDiscoveryWarnings, ...buildDiscoveryWarnings, ...toolInputDiscoveryWarnings].map((warning) => warning.message));
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

  function isPerplexityTool(tool: DiscoveredLlamaCppTool): boolean {
    return tool.exists && (tool.kind === "perplexity" || tool.fileName.toLowerCase().includes("llama-perplexity"));
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
    toolInputFoldersText = "";
    discoveredModels = [];
    discoveredBuilds = [];
    discoveredToolInputs = [];
    detection = null;
    detectedProcesses = [];
    portStatus = null;
    gpuStatus = null;
    runtimeHealth = null;
    readiness = null;
    testChatResult = null;
    modelDiscoveryWarnings = [];
    buildDiscoveryWarnings = [];
    toolInputDiscoveryWarnings = [];
    selectedModelPath = "";
    selectedBuildPath = "";
    selectedBenchModelPath = "";
    selectedBenchPath = "";
    selectedPerplexityModelPath = "";
    selectedPerplexityPath = "";
    selectedDatasetPath = "";
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
    toolInputFoldersText = response.settings.toolInputFolders.join("\n");
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
    if (!selectedPerplexityModelPath && response.models.length) {
      selectedPerplexityModelPath = response.models[0].path;
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
    const perplexityTools = response.builds.flatMap((build) => build.tools.filter(isPerplexityTool));
    if (!selectedPerplexityPath || !perplexityTools.some((tool) => tool.path === selectedPerplexityPath)) {
      const firstPerplexityTool = perplexityTools[0];
      selectedPerplexityPath = firstPerplexityTool?.path ?? "";
    }
  }

  async function loadToolInputs(method: "GET" | "POST" = "GET"): Promise<void> {
    const response = await fetchJson<ToolInputDiscoveryResponse>("/api/discovery/tool-inputs" + (method === "POST" ? "/rescan" : ""), { method });
    discoveredToolInputs = response.files;
    toolInputDiscoveryWarnings = response.warnings;
    if (!selectedDatasetPath && response.files.length) {
      selectedDatasetPath = response.files[0].path;
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

  async function loadReadiness(): Promise<void> {
    readiness = await fetchJson<ReadinessResponse>("/api/readiness");
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
      await Promise.all([loadStatus(), loadRuntime(), loadProfiles(), loadLogs(), loadJobs(), loadSettings(), loadModels(), loadBuilds(), loadToolInputs(), loadDetection(), loadProcesses(), loadGpuStatus(), loadRuntimeHealth(), loadReadiness()]);
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
          llamaCppFolders: linesFromText(llamaCppFoldersText),
          toolInputFolders: linesFromText(toolInputFoldersText)
        })
      });
      settings = response.settings;
      modelFoldersText = response.settings.modelFolders.join("\n");
      llamaCppFoldersText = response.settings.llamaCppFolders.join("\n");
      toolInputFoldersText = response.settings.toolInputFolders.join("\n");
      actionMessage = "Discovery folders saved. Scans still only read configured folders.";
      await Promise.all([loadModels("POST"), loadBuilds("POST"), loadToolInputs("POST")]);
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

  async function rescanToolInputs(): Promise<void> {
    await runAction("rescan-tool-inputs", async () => {
      await loadToolInputs("POST");
      actionMessage = "Tool input scan finished. Only file metadata was read.";
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

  async function runLlamaPerplexityJob(): Promise<void> {
    if (!selectedPerplexityModel || !selectedPerplexityTool || !selectedDataset) {
      return;
    }

    await runAction("run-llama-perplexity", async () => {
      const body: LlamaPerplexityRequestPayload = {
        buildId: selectedPerplexityTool.build.id,
        perplexityPath: selectedPerplexityTool.tool.path,
        modelPath: selectedPerplexityModel.path,
        datasetPath: selectedDataset.path,
        args: {
          threads: perplexityForm.threads,
          ctxSize: perplexityForm.ctxSize,
          batchSize: perplexityForm.batchSize,
          ubatchSize: perplexityForm.ubatchSize,
          nGpuLayers: perplexityForm.nGpuLayers
        }
      };
      const response = await fetchJson<JobActionResponse>("/api/jobs/llama-perplexity", {
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

  function syncActivePage(): void {
    const nextPage = pageFromHash(window.location.hash);
    activePage = nextPage;
    if (!window.location.hash || window.location.hash !== `#${nextPage}`) {
      history.replaceState(null, "", `#${nextPage}`);
    }
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

  const pageData = $derived({
    status,
    runtime,
    profiles,
    selectedProfileId,
    selectedProfile,
    command,
    commandLines,
    logs,
    filteredLogs,
    logLines,
    jobs,
    selectedJobId,
    selectedJob,
    selectedJobBenchResult,
    selectedJobPerplexityResult,
    runningJob,
    jobLogs,
    jobLogLines,
    errorMessage,
    actionMessage,
    validation,
    isLoading,
    pendingAction,
    logSearch,
    logStreamState,
    logConnectionTone,
    logStatusText,
    lastLogHeartbeat,
    settings,
    modelFoldersText,
    llamaCppFoldersText,
    toolInputFoldersText,
    discoveredModels,
    discoveredBuilds,
    discoveredToolInputs,
    detection,
    detectedProcesses,
    portStatus,
    gpuStatus,
    runtimeHealth,
    readiness,
    testChatResult,
    warnings,
    detectionWarnings,
    discoveryWarningLines,
    gpuWarnings,
    gpuTone,
    selectedProfilePortConflict,
    selectedProfilePortMessage,
    apiUrl,
    runtimeStatus,
    runtimeTone,
    serviceLabel,
    serviceState,
    runningModeLabel,
    dataDirModeLabel,
    logDirModeLabel,
    selectedModelPath,
    selectedBuildPath,
    selectedModel,
    selectedBuild,
    profileForm,
    createdProfilePreview,
    selectedBenchModel,
    selectedBenchTool,
    selectedPerplexityModel,
    selectedPerplexityTool,
    selectedDataset,
    benchToolOptions,
    perplexityToolOptions,
    benchForm,
    perplexityForm,
    formatBytes,
    formatDate,
    formatMiB
  });

  const pageActions = {
    refreshAll,
    logout,
    loadLogs,
    loadProfiles,
    fetchJson,
    runAction,
    setSelectedProfileId,
    setCommand,
    setValidationResult,
    setActionMessage,
    validateSelectedProfile,
    startSelectedProfile,
    stopRuntime,
    restartRuntime,
    runTestJob,
    runLlamaBenchJob,
    runLlamaPerplexityJob,
    cancelJob,
    copyCommand,
    copyLogs,
    clearVisibleLogs,
    saveDiscoveryFolders,
    rescanModels,
    rescanBuilds,
    rescanToolInputs,
    createProfileFromSelection,
    refreshGpuStatus,
    checkRuntimeHealth,
    runRuntimeTestChat,
    jobTone,
    selectModel: (path: string) => (selectedModelPath = path),
    selectBuild: (path: string) => (selectedBuildPath = path)
  };

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

  onMount(() => {
    syncActivePage();
    window.addEventListener("hashchange", syncActivePage);
    return () => window.removeEventListener("hashchange", syncActivePage);
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

{#if authMode === "checking"}
  <main class="auth-shell">
    <Panel tone="code" eyebrow="Authentication" title="Checking admin access" class="auth-panel">
      <p class="empty-copy">Checking ObsidianLM authentication status...</p>
    </Panel>
  </main>
{:else if authMode === "setup-required"}
  <main class="auth-shell">
    <Panel tone="live" eyebrow="Authentication" title="Set up admin token" class="auth-panel">
      <form class="auth-form" onsubmit={(event) => { event.preventDefault(); void submitSetup(); }}>
        <p class="empty-copy">Create the local admin token used to unlock protected ObsidianLM controls in this browser.</p>
        <label class="form-field">Admin token<input type="password" autocomplete="new-password" bind:value={tokenInput} placeholder="Set up admin token" /></label>
        <label class="form-field">Confirm token<input type="password" autocomplete="new-password" bind:value={tokenConfirmInput} placeholder="Repeat admin token" /></label>
        {#if authErrorMessage}<p class="auth-error">{authErrorMessage}</p>{/if}
        <div class="panel-actions inline-actions"><ToolbarButton type="submit" variant="success" disabled={authPendingAction === "setup"}>{authPendingAction === "setup" ? "Saving..." : "Set up admin token"}</ToolbarButton></div>
        <p class="helper-text">Stored in browser localStorage for v1 only. Token values are never placed in URLs.</p>
      </form>
    </Panel>
  </main>
{:else if authMode === "logged-out"}
  <main class="auth-shell">
    <Panel tone="code" eyebrow="Authentication" title="Enter admin token" class="auth-panel">
      <form class="auth-form" onsubmit={(event) => { event.preventDefault(); void submitLogin(); }}>
        {#if authMessage}<p class="auth-success">{authMessage}</p>{/if}
        <p class="empty-copy">Enter admin token to load runtime profiles, jobs, settings, and live logs.</p>
        <label class="form-field">Admin token<input type="password" autocomplete="current-password" bind:value={tokenInput} placeholder="Enter admin token" /></label>
        {#if authErrorMessage}<p class="auth-error">{authErrorMessage}</p>{/if}
        <div class="panel-actions inline-actions"><ToolbarButton type="submit" variant="primary" disabled={authPendingAction === "login"}>{authPendingAction === "login" ? "Checking..." : "Login"}</ToolbarButton></div>
      </form>
    </Panel>
  </main>
{:else}
  <AppShell
    {activePage}
    runtimeStatus={runtimeStatus}
    runtimeTone={runtimeTone}
    serviceLabel={serviceLabel}
    serviceState={serviceState}
    port={`${portStatus?.port?.port ?? selectedProfile?.port ?? status?.managedLlamaPort ?? 8085}`}
    isLoading={isLoading}
    authPendingAction={authPendingAction}
    onRefresh={refreshAll}
    onLogout={logout}
  >
    {#snippet inspector()}
      {#if activePage === "dashboard"}<DashboardInspector data={pageData} />{/if}
      {#if activePage === "runtime"}<RuntimeInspector data={pageData} />{/if}
      {#if activePage === "profiles"}<ProfileInspector data={pageData} actions={pageActions} />{/if}
      {#if activePage === "models"}<ModelInspector model={selectedModel} {formatBytes} {formatDate} />{/if}
      {#if activePage === "builds"}<BuildInspector build={selectedBuild} />{/if}
    {/snippet}

    {#if errorMessage}
      <Panel tone="danger" eyebrow="Notice" title="Action needs attention" class="offline-panel"><p class="error-detail">{errorMessage}</p></Panel>
    {/if}
    {#if actionMessage}
      <Panel tone="live" eyebrow="Result" title="Latest action" class="offline-panel"><p class="empty-copy">{actionMessage}</p></Panel>
    {/if}

    {#if activePage === "dashboard"}
      <DashboardPage data={pageData} actions={pageActions} />
    {:else if activePage === "runtime"}
      <RuntimePage data={pageData} actions={pageActions} />
    {:else if activePage === "profiles"}
      <ProfilesPage data={pageData} actions={pageActions} />
    {:else if activePage === "models"}
      <ModelsPage data={pageData} actions={pageActions} />
    {:else if activePage === "builds"}
      <BuildsPage data={pageData} actions={pageActions} />
    {:else if activePage === "jobs"}
      <JobsPage
        data={pageData}
        actions={pageActions}
        bind:selectedJobId
        bind:selectedBenchModelPath
        bind:selectedBenchPath
        bind:selectedPerplexityModelPath
        bind:selectedPerplexityPath
        bind:selectedDatasetPath
      />
    {:else if activePage === "logs"}
      <LogsPage data={pageData} actions={pageActions} bind:logSearch />
    {:else if activePage === "telemetry"}
      <TelemetryPage data={pageData} actions={pageActions} />
    {:else if activePage === "settings"}
      <SettingsPage data={pageData} actions={pageActions} bind:modelFoldersText bind:llamaCppFoldersText bind:toolInputFoldersText />
    {:else if activePage === "system"}
      <SystemPage data={pageData} actions={pageActions} />
    {/if}
  </AppShell>
{/if}
