import type { CommandSpec, GpuDevice, ProfileValidationResponse, RuntimeProfile } from "@obsidianlm/shared";
import { API_ENDPOINTS, fetchJson, readStoredAdminToken, type GpuMonitoringStatus, type ProfileListResponse, type RuntimeLogsResponse, type RuntimeState } from "../api";

export type RuntimeStateResponse = {
  state: RuntimeState;
  warnings: string[];
};

export type RuntimeCommandResponse = {
  command: CommandSpec;
};

export type DashboardData = {
  runtimeState: RuntimeState | null;
  runtimeWarnings: string[];
  runtimeCommand: CommandSpec | null;
  runtimeLogs: RuntimeLogsResponse["logs"];
  gpuStatus: GpuMonitoringStatus | null;
  profiles: ProfileListResponse["profiles"];
  usedProfileCommandFallback: boolean;
  hasToken: boolean;
  loadedAt: string | null;
};

export type InspectorValidationRow = {
  label: string;
  status: "ok" | "warning" | "error" | "empty";
  detail: string;
};

export type DashboardInspectorData = {
  profile: RuntimeProfile | null;
  validation: ProfileValidationResponse | null;
  hasToken: boolean;
};

export const emptyDashboardInspectorData: DashboardInspectorData = {
  profile: null,
  validation: null,
  hasToken: false
};

export const emptyDashboardData: DashboardData = {
  runtimeState: null,
  runtimeWarnings: [],
  runtimeCommand: null,
  runtimeLogs: [],
  gpuStatus: null,
  profiles: [],
  usedProfileCommandFallback: false,
  hasToken: false,
  loadedAt: null
};

async function protectedFetch<T>(url: string, token: string): Promise<T | null> {
  try {
    return await fetchJson<T>(url, undefined, { token });
  } catch {
    return null;
  }
}

export async function fetchDashboardData(activeProfileIdFallback: string | null = null): Promise<DashboardData> {
  const token = readStoredAdminToken();
  if (!token) {
    return { ...emptyDashboardData };
  }

  const [runtimeResponse, logsResponse, gpuStatus, profilesResponse] = await Promise.all([
    protectedFetch<RuntimeStateResponse>(API_ENDPOINTS.runtime.state, token),
    protectedFetch<RuntimeLogsResponse>(API_ENDPOINTS.runtime.logs(24), token),
    protectedFetch<GpuMonitoringStatus>(API_ENDPOINTS.monitoring.gpu, token),
    protectedFetch<ProfileListResponse>(API_ENDPOINTS.profiles.list, token)
  ]);

  const runtimeCommandResponse = await protectedFetch<RuntimeCommandResponse>(API_ENDPOINTS.runtime.command, token);
  const activeProfileId = runtimeResponse?.state.activeProfileId ?? activeProfileIdFallback;
  const fallbackProfile = activeProfileId ? profilesResponse?.profiles.find((profile) => profile.id === activeProfileId) : null;
  const fallbackCommandResponse = runtimeCommandResponse ? null : fallbackProfile ? await protectedFetch<RuntimeCommandResponse>(API_ENDPOINTS.profiles.command(fallbackProfile.id), token) : null;

  return {
    runtimeState: runtimeResponse?.state ?? null,
    runtimeWarnings: runtimeResponse?.warnings ?? [],
    runtimeCommand: runtimeCommandResponse?.command ?? fallbackCommandResponse?.command ?? null,
    runtimeLogs: logsResponse?.logs ?? [],
    gpuStatus,
    profiles: profilesResponse?.profiles ?? [],
    usedProfileCommandFallback: !runtimeCommandResponse && Boolean(fallbackCommandResponse),
    hasToken: true,
    loadedAt: new Date().toISOString()
  };
}

export async function fetchDashboardInspectorData(activeProfileId: string | null = null): Promise<DashboardInspectorData> {
  const token = readStoredAdminToken();
  if (!token) {
    return { ...emptyDashboardInspectorData };
  }

  const [validationResponse, profileDetailResponse] = await Promise.all([
    activeProfileId ? protectedFetch<ProfileValidationResponse>(API_ENDPOINTS.profiles.validate(activeProfileId), token) : null,
    activeProfileId ? protectedFetch<{ profile: RuntimeProfile }>(API_ENDPOINTS.profiles.detail(activeProfileId), token) : null
  ]);

  const profile = profileDetailResponse?.profile ?? null;
  const validation = validationResponse ?? null;

  return {
    profile,
    validation,
    hasToken: true
  };
}
