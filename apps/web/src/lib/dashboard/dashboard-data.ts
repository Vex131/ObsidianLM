import type { CommandSpec, ConfiguredModelDetails, LlamaCppBuildDetails, ProcessListResponse, RouterRuntimeResponse } from "@obsidianlm/shared";
import { API_ENDPOINTS, fetchJson, readStoredAdminToken, type GpuMonitoringStatus, type ReadinessResponse, type RuntimeHealthResponse, type RuntimeLogsResponse } from "../api";

export type DashboardData = {
  runtime: RouterRuntimeResponse | null;
  runtimeCommand: CommandSpec | null;
  configuredModels: ConfiguredModelDetails[];
  builds: LlamaCppBuildDetails[];
  runtimeLogs: RuntimeLogsResponse["logs"];
  gpuStatus: GpuMonitoringStatus | null;
  readiness: ReadinessResponse | null;
  runtimeHealth: RuntimeHealthResponse | null;
  processes: ProcessListResponse | null;
  hasToken: boolean;
  loadedAt: string | null;
};

export const emptyDashboardData: DashboardData = {
  runtime: null, runtimeCommand: null, configuredModels: [], builds: [], runtimeLogs: [], gpuStatus: null,
  readiness: null, runtimeHealth: null, processes: null, hasToken: false, loadedAt: null
};

async function protectedFetch<T>(url: string, token: string): Promise<T | null> {
  try { return await fetchJson<T>(url, undefined, { token }); } catch { return null; }
}

/** Router, configured models, and builds are the required runtime authority. */
export async function fetchDashboardData(): Promise<DashboardData> {
  const token = readStoredAdminToken();
  if (!token) return { ...emptyDashboardData };
  const [runtime, configured, builds] = await Promise.all([
    protectedFetch<RouterRuntimeResponse>(API_ENDPOINTS.runtime.state, token),
    protectedFetch<{ configuredModels: ConfiguredModelDetails[] }>(API_ENDPOINTS.configuredModels.list, token),
    protectedFetch<{ builds: LlamaCppBuildDetails[] }>(API_ENDPOINTS.builds.list, token)
  ]);
  const catalog = runtime?.routerState.status === "running"
    ? await protectedFetch<{ routerState: RouterRuntimeResponse["routerState"] }>(API_ENDPOINTS.runtime.catalog, token)
    : null;
  const [command, logs, gpuStatus, readiness, runtimeHealth, processes] = await Promise.all([
    protectedFetch<{ command: CommandSpec }>(API_ENDPOINTS.runtime.command, token),
    protectedFetch<RuntimeLogsResponse>(API_ENDPOINTS.runtime.logs(24), token),
    protectedFetch<GpuMonitoringStatus>(API_ENDPOINTS.monitoring.gpu, token),
    protectedFetch<ReadinessResponse>(API_ENDPOINTS.readiness, token),
    protectedFetch<RuntimeHealthResponse>(API_ENDPOINTS.runtime.health, token),
    protectedFetch<ProcessListResponse>(API_ENDPOINTS.processes.llama, token)
  ]);
  return {
    runtime: runtime && catalog ? { ...runtime, routerState: catalog.routerState } : runtime,
    runtimeCommand: command?.command ?? null, configuredModels: configured?.configuredModels ?? [], builds: builds?.builds ?? [],
    runtimeLogs: logs?.logs ?? [], gpuStatus, readiness, runtimeHealth, processes, hasToken: true, loadedAt: new Date().toISOString()
  };
}
