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
  LlamaBuildDiscoveryResponse,
  LlamaPerplexityRequest,
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
  AppSettings
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
    updateDiscoveryFolders: "/api/settings/discovery-folders"
  },
  readiness: "/api/readiness",
  discovery: {
    models: "/api/discovery/models",
    rescanModels: "/api/discovery/models/rescan",
    llamaBuilds: "/api/discovery/llama-builds",
    rescanLlamaBuilds: "/api/discovery/llama-builds/rescan",
    toolInputs: "/api/discovery/tool-inputs",
    rescanToolInputs: "/api/discovery/tool-inputs/rescan",
    createProfile: "/api/discovery/profiles"
  },
  runtime: {
    state: "/api/runtime",
    detection: "/api/runtime/detection",
    command: "/api/runtime/command",
    health: "/api/runtime/health",
    testChat: "/api/runtime/test-chat",
    stop: "/api/runtime/stop",
    restart: "/api/runtime/restart",
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
    start: (id: string) => `/api/profiles/${enc(id)}/start`
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
  LlamaBuildDiscoveryResponse,
  LlamaPerplexityRequest,
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
  ToolInputDiscoveryResponse
};
