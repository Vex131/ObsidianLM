import type {
  AdminTokenRequest,
  AuthLogoutResponse,
  AuthSetupResponse,
  AuthStatusResponse,
  AuthVerifyResponse,
  CreateProfileFromDiscoveryRequest,
  CreateProfileFromDiscoveryResponse,
  DiscoverySettingsUpdate,
  ExportProfilesResponse,
  ImportProfilesRequest,
  ImportProfilesResponse,
  JobActionResponse,
  JobDetailResponse,
  JobListResponse,
  JobLogsResponse,
  LlamaBenchRequest,
  LlamaBuildCapabilitiesManifest,
  LlamaBuildDiscoveryResponse,
  LlamaBuildUsageResponse,
  LlamaPerplexityRequest,
  GgufMetadataInspection,
  ModelArtifactUsageResponse,
  ModelDiscoveryResponse,
  PortStatus,
  ProcessListResponse,
  ProfileConfigSnippetResponse,
  ProfileDetailResponse,
  ProfileListResponse,
  ProfileMutationResponse,
  ProfileValidationResponse,
  ReadinessResponse,
  RuntimeActionResult,
  RuntimeHealthResponse,
  RuntimeLogsResponse,
  RuntimeLogsStreamEvent,
  RuntimeState,
  RuntimeTestChatRequest,
  RuntimeTestChatResponse,
  StatusResponse,
  ToolInputDiscoveryResponse,
   GpuMonitoringStatus,
   AppSettings,
   RuntimeSettingsResponse,
   RuntimeSettingsUpdate,
   ServiceLogsResponse
} from "@obsidianlm/shared";

export const adminTokenStorageKey = "obsidianlm.adminToken";

const enc = encodeURIComponent;

export const API_ENDPOINTS = {
  status: "/api/status",
  auth: {
    status: "/api/auth/status",
    setup: "/api/auth/setup",
    verify: "/api/auth/verify",
    logout: "/api/auth/logout"
  },
  settings: {
    get: "/api/settings",
    updateDiscoveryFolders: "/api/settings/discovery-folders",
    updateRuntime: "/api/settings/runtime"
  },
  readiness: "/api/readiness",
  discovery: {
    models: "/api/discovery/models",
    modelUsage: "/api/discovery/models/usage",
    modelMetadata: (id: string) => `/api/discovery/models/${enc(id)}/metadata`,
    rescanModels: "/api/discovery/models/rescan",
    llamaBuilds: "/api/discovery/llama-builds",
    llamaBuildUsage: "/api/discovery/llama-builds/usage",
    rescanLlamaBuilds: "/api/discovery/llama-builds/rescan",
    toolInputs: "/api/discovery/tool-inputs",
    rescanToolInputs: "/api/discovery/tool-inputs/rescan",
    createProfile: "/api/discovery/profiles",
    llamaBuildCapabilities: (id: string) => `/api/discovery/llama-builds/${enc(id)}/capabilities`
  },
  runtime: {
    state: "/api/runtime",
    detection: "/api/runtime/detection",
    command: "/api/runtime/command",
    health: "/api/runtime/health",
    testChat: "/api/runtime/test-chat",
    stop: "/api/runtime/stop",
    restart: "/api/runtime/restart",
    start: "/api/runtime/start",
    switchModel: "/api/runtime/switch-model",
    switchBuild: "/api/runtime/switch-build",
    catalog: "/api/runtime/catalog",
    logs: (limit = 300) => `/api/runtime/logs?limit=${enc(String(limit))}`,
    logStream: (limit = 100) => `/api/runtime/logs/stream?limit=${enc(String(limit))}`
  },
  profiles: {
    list: "/api/profiles",
    create: "/api/profiles",
    export: "/api/profiles/export",
    import: "/api/profiles/import",
    detail: (id: string) => `/api/profiles/${enc(id)}`,
    update: (id: string) => `/api/profiles/${enc(id)}`,
    delete: (id: string) => `/api/profiles/${enc(id)}`,
    duplicate: (id: string) => `/api/profiles/${enc(id)}/duplicate`,
    validate: (id: string) => `/api/profiles/${enc(id)}/validate`,
    command: (id: string) => `/api/profiles/${enc(id)}/command`,
    snippets: (id: string) => `/api/profiles/${enc(id)}/snippets`,
    start: (id: string) => `/api/profiles/${enc(id)}/start`,
    validateDraft: "/api/profiles/validate-draft",
    previewCommand: "/api/profiles/preview-command"
  },
  jobs: {
    list: "/api/jobs",
    detail: (id: string) => `/api/jobs/${enc(id)}`,
    test: "/api/jobs/test",
    llamaBench: "/api/jobs/llama-bench",
    llamaPerplexity: "/api/jobs/llama-perplexity",
    cancel: (id: string) => `/api/jobs/${enc(id)}/cancel`,
    logs: (id: string, limit = 80) => `/api/jobs/${enc(id)}/logs?limit=${enc(String(limit))}`
  },
  modelArtifacts: {
    list: "/api/model-artifacts",
    detail: (id: string) => `/api/model-artifacts/${enc(id)}`,
    register: "/api/model-artifacts/register",
    reconcile: (id: string) => `/api/model-artifacts/${enc(id)}/reconcile`,
    update: (id: string) => `/api/model-artifacts/${enc(id)}`,
    delete: (id: string) => `/api/model-artifacts/${enc(id)}`
  },
  configuredModels: {
    list: "/api/configured-models",
    create: "/api/configured-models",
    detail: (id: string) => `/api/configured-models/${enc(id)}`,
    update: (id: string) => `/api/configured-models/${enc(id)}`,
    duplicate: (id: string) => `/api/configured-models/${enc(id)}/duplicate`,
    revalidate: (id: string) => `/api/configured-models/${enc(id)}/revalidate`,
    delete: (id: string) => `/api/configured-models/${enc(id)}`
  },
  builds: {
    list: "/api/builds",
    detail: (id: string) => `/api/builds/${enc(id)}`,
    register: "/api/builds/register",
    reconcile: (id: string) => `/api/builds/${enc(id)}/reconcile`,
    validateRouter: (id: string) => `/api/builds/${enc(id)}/validate-router`,
    capabilities: (id: string) => `/api/builds/${enc(id)}/capabilities`,
    update: (id: string) => `/api/builds/${enc(id)}`,
    delete: (id: string) => `/api/builds/${enc(id)}`,
    presetPreview: (id: string) => `/api/builds/${enc(id)}/router-preset/preview`,
    generatePreset: (id: string) => `/api/builds/${enc(id)}/router-preset/generate`,
    launchPreview: (id: string) => `/api/builds/${enc(id)}/router-launch/preview`
  },
  logs: {
    service: "/api/logs/service"
  },
  monitoring: {
    ports: (port?: number | string) => (port === undefined ? "/api/monitoring/ports" : `/api/monitoring/ports?port=${enc(String(port))}`),
    gpu: "/api/monitoring/gpu"
  },
  processes: {
    llama: "/api/processes/llama"
  }
} as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ApiFetchOptions {
  token?: string | null;
  onUnauthorized?: () => void;
}

export class ApiRequestError extends Error {
  readonly statusCode: number;
  readonly url: string;
  readonly data: unknown;

  constructor(statusCode: number, url: string, message: string, data: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.statusCode = statusCode;
    this.url = url;
    this.data = data;
  }
}

export function friendlyRequestError(statusCode: number, fallback?: string): string {
  if (statusCode === 401 || statusCode === 403) {
    return "Invalid token";
  }
  if (statusCode === 423) {
    return fallback || "Admin token setup is required";
  }
  return fallback || `Request failed with ${statusCode}`;
}

function storageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readStoredAdminToken(): string | null {
  return storageAvailable() ? window.localStorage.getItem(adminTokenStorageKey) : null;
}

export function writeStoredAdminToken(token: string): void {
  if (storageAvailable()) {
    window.localStorage.setItem(adminTokenStorageKey, token);
  }
}

export function clearStoredAdminToken(): void {
  if (storageAvailable()) {
    window.localStorage.removeItem(adminTokenStorageKey);
  }
}

async function readResponseData(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function messageFromData(data: unknown): string | undefined {
  return data && typeof data === "object" && "message" in data && typeof data.message === "string" ? data.message : undefined;
}

export async function publicFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await readResponseData(response);

  if (!response.ok) {
    throw new ApiRequestError(response.status, url, friendlyRequestError(response.status, messageFromData(data)), data);
  }

  return data as T;
}

export async function fetchJson<T>(url: string, init?: RequestInit, options: ApiFetchOptions = {}): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = options.token === undefined ? readStoredAdminToken() : options.token;

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(url, { ...init, headers });
  const data = await readResponseData(response);

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      clearStoredAdminToken();
      options.onUnauthorized?.();
    }
    throw new ApiRequestError(response.status, url, friendlyRequestError(response.status, messageFromData(data)), data);
  }

  return data as T;
}

export async function setupAdminToken(token: string): Promise<AuthSetupResponse> {
  const response = await publicFetchJson<AuthSetupResponse>(API_ENDPOINTS.auth.setup, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token } satisfies AdminTokenRequest)
  });
  writeStoredAdminToken(token);
  return response;
}

export async function verifyAdminToken(token: string): Promise<AuthVerifyResponse> {
  return publicFetchJson<AuthVerifyResponse>(API_ENDPOINTS.auth.verify, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token } satisfies AdminTokenRequest)
  });
}

export type {
  AdminTokenRequest,
  AppSettings,
  AuthLogoutResponse,
  AuthSetupResponse,
  AuthStatusResponse,
  AuthVerifyResponse,
  CreateProfileFromDiscoveryRequest,
  CreateProfileFromDiscoveryResponse,
  DiscoverySettingsUpdate,
  ExportProfilesResponse,
  GpuMonitoringStatus,
  ImportProfilesRequest,
  ImportProfilesResponse,
  JobActionResponse,
  JobDetailResponse,
  JobListResponse,
  JobLogsResponse,
  LlamaBenchRequest,
  LlamaBuildCapabilitiesManifest,
  LlamaBuildDiscoveryResponse,
  LlamaBuildUsageResponse,
  LlamaPerplexityRequest,
  GgufMetadataInspection,
  ModelArtifactUsageResponse,
  ModelDiscoveryResponse,
  PortStatus,
  ProcessListResponse,
  ProfileConfigSnippetResponse,
  ProfileDetailResponse,
  ProfileListResponse,
  ProfileMutationResponse,
  ProfileValidationResponse,
  ReadinessResponse,
  RuntimeActionResult,
  RuntimeHealthResponse,
  RuntimeLogsResponse,
  RuntimeLogsStreamEvent,
  RuntimeState,
  RuntimeTestChatRequest,
  RuntimeTestChatResponse,
   StatusResponse,
   ToolInputDiscoveryResponse,
   RuntimeSettingsUpdate,
   RuntimeSettingsResponse,
   ServiceLogsResponse
};

export type { RuntimeSettingsResponse as SettingsResponse } from "@obsidianlm/shared";
